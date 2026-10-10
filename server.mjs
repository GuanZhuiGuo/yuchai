import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createReadStream, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

export const PROJECT_ID = 5;
export const USER_ID = 1;
export const ALLOWED_PLAN_IDS = new Set([47, 49, 71, 72, 73, 74, 75, 76]);
export const DEFAULT_UPSTREAM_ORIGIN = 'https://e168-6-124finder.datarangers-onpremise.volces.com';
const API_PREFIX = '/datafinder/wscompass/api/v3/sparring/openapi/v1';
const PUBLIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_HTTP_BODY = 16 * 1024;
const MAX_WS_MESSAGE = 2 * 1024 * 1024;
const MAX_WS_BUFFER = 4 * 1024 * 1024;

export class ApiError extends Error {
  constructor(status, code, message, retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

// The same UTF-8 body is hashed and sent; URL query parameters are excluded.
export function signRequest({ method, pathname, body = '', accessKey, secretKey, timestamp, nonce }) {
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  const requestNonce = nonce ?? randomUUID();
  const hash = createHash('sha256').update(body, 'utf8').digest('hex');
  const stringToSign = [method.toUpperCase(), pathname, hash, ts, requestNonce].join('\n');
  return {
    'X-Ak': accessKey,
    'X-Timestamp': ts,
    'X-Nonce': requestNonce,
    'X-Signature': createHmac('sha256', secretKey).update(stringToSign).digest('hex'),
    'Content-Type': 'application/json',
  };
}

function positiveInteger(value, label) {
  const n = typeof value === 'number' ? value : /^\d+$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, 'INVALID_PARAMETER', `${label} 必须为正整数`);
  return n;
}

function allowedPlan(value) {
  const id = positiveInteger(value, '计划 ID');
  if (!ALLOWED_PLAN_IDS.has(id)) throw new ApiError(403, 'PLAN_NOT_ALLOWED', '此演示仅开放指定的陪练课程');
  return id;
}

function normalizedPlan(item, type) {
  return {
    id: positiveInteger(item.id, '计划 ID'),
    name: String(item.name ?? ''),
    status: String(item.status ?? ''),
    type: String(item.plan_type ?? type),
    practiced: Boolean(item.practice_flag),
    classification: String(item.plan_classification ?? ''),
    estimatedDuration: item.estimated_duration != null && Number.isFinite(Number(item.estimated_duration)) ? Number(item.estimated_duration) : null,
  };
}

export function publicPlanDetail(data, id) {
  return {
    id,
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    status: String(data.status ?? ''),
    type: String(data.plan_type ?? ''),
    roles: (Array.isArray(data.role) ? data.role : []).map((role) => ({
      id: positiveInteger(role.id, '角色 ID'),
      name: String(role.name ?? ''),
      voice: String(role.persona?.voice ?? ''),
      difficulty: String(role.persona?.difficulty_level ?? ''),
    })),
    dialogueMode: String(data.dialogue_mode_info?.sparring_role_type ?? ''),
    flowControl: {
      startControl: String(data.flow_control?.start_control ?? ''),
      endControl: String(data.flow_control?.end_control ?? ''),
    },
    passingScore: data.passing_score == null ? null : Number(data.passing_score),
  };
}

export function publicReportDetail(data) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const pick = (value, fields) => {
    const source = object(value);
    return Object.fromEntries(fields.filter(key => Object.hasOwn(source, key) &&
      (source[key] === null || ['string', 'boolean'].includes(typeof source[key]) ||
        (typeof source[key] === 'number' && Number.isFinite(source[key]))))
      .map(key => [key, source[key]]));
  };
  const map = (source, target, key, project) => {
    if (Array.isArray(source[key])) target[key] = source[key].map(project);
    else if (source[key] === null) target[key] = null;
  };
  const report = object(data);
  const result = pick(report, ['report_version', 'status', 'dialogue_round_count', 'average_score', 'score_rank_percent']);
  if (!Object.hasOwn(report, 'report_detail')) return result;
  const detail = object(report.report_detail);
  const visible = pick(detail, ['final_score', 'passing_score', 'finished_time', 'time_spent', 'final_conclusion', 'version']);
  map(detail, visible, 'evaluation_rule', value => {
    const dimension = object(value);
    const output = pick(dimension, ['name', 'weight', 'eval_score', 'eval_total_score', 'eval_reason', 'eval_suggestion']);
    map(dimension, output, 'related_scene', value => {
      const scene = object(value);
      const output = pick(scene, ['index', 'sceneName']);
      map(scene, output, 'topics', value => {
        const topic = object(value);
        const output = pick(topic, ['index', 'name', 'is_should_counted', 'should_user_initiate', 'score', 'reason', 'suggestion']);
        map(topic, output, 'related_text', reference => pick(reference, ['type', 'text']));
        return output;
      });
      return output;
    });
    return output;
  });
  map(detail, visible, 'turn_evaluations', turn => pick(turn, ['role', 'content', 'evaluation_level', 'evaluation']));
  // The upstream scenes contain hidden prompts and scoring benchmarks, not feedback.
  result.report_detail = report.report_detail === null ? null : visible;
  return result;
}

function exerciseSummary(data, record) {
  const id = positiveInteger(data.exercise_id ?? data.id ?? record?.id, '练习 ID');
  return {
    id,
    exerciseId: id,
    planId: Number(data.plan_id ?? record?.planId),
    roleId: Number(data.role_id ?? data.role_detail?.id ?? record?.roleId),
    name: String(data.name ?? record?.name ?? ''),
    status: String(data.status ?? ''),
    dialogueMode: record?.dialogueMode ?? null,
  };
}

function localRequest(req) {
  try {
    const url = new URL(`http://${req.headers.host}`);
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      url.username === '' && url.password === '' && url.pathname === '/';
  } catch {
    return false;
  }
}

export function deploymentOrigin(value = '') {
  if (!value) return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN 必须为不含路径或凭证的 HTTP/HTTPS 来源');
  }
  return url.origin;
}

function sameOrigin(req, publicOrigin) {
  return localRequest(req) && (req.headers.origin === `http://${req.headers.host}` ||
    Boolean(publicOrigin && req.headers.origin === publicOrigin));
}

async function requestBody(req) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'JSON_REQUIRED', '请求需使用 JSON 格式');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_HTTP_BODY) throw new ApiError(413, 'BODY_TOO_LARGE', '请求内容过大');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', '请求 JSON 格式无效');
  }
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendError(res, error) {
  const known = error instanceof ApiError;
  sendJSON(res, known ? error.status : 500, {
    error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : '服务暂时不可用，请稍后重试',
      retryable: known ? error.retryable : true,
    },
  });
}

// A static resource accepts one standards-compliant byte range only.
export function parseByteRange(value, size) {
  if (typeof value !== 'string' || !Number.isSafeInteger(size) || size < 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(size - 1, requestedEnd) };
}

function upstreamBusinessError(code, action) {
  if (Number(code) === 404) return new ApiError(404, 'UPSTREAM_NOT_FOUND', action === 'report'
    ? '评测报告尚未就绪，或练习记录不存在' : '所请求的上游记录不存在', action === 'report');
  if (Number(code) === 400) return new ApiError(400, 'UPSTREAM_INVALID_PARAMETER', '上游未接受请求参数');
  if (Number(code) === 401 || Number(code) === 403) return new ApiError(502, 'UPSTREAM_AUTH_REJECTED', '上游接入鉴权未通过');
  return new ApiError(502, 'UPSTREAM_ERROR', action === 'start'
    ? '上游未能创建练习，角色可能尚未就绪' : '上游服务暂时不可用', true);
}

export function createApplication({
  accessKey = process.env.SPARRING_OPENAPI_ACCESS_KEY ?? '',
  secretKey = process.env.SPARRING_OPENAPI_SECRET_KEY ?? '',
  upstreamOrigin = DEFAULT_UPSTREAM_ORIGIN,
  upstreamFetch = globalThis.fetch,
  publicRoot = PUBLIC_ROOT,
  publicOrigin = process.env.PUBLIC_ORIGIN ?? '',
  connectWebSocket = (url, options) => new WebSocket(url, options),
} = {}) {
  const acceptedPublicOrigin = deploymentOrigin(publicOrigin);
  const publicSocketOrigin = acceptedPublicOrigin
    ? acceptedPublicOrigin.replace(/^http/, 'ws') : '';
  const configured = Boolean(accessKey && secretKey);
  const exercises = new Map();
  const activeVoice = new Map();
  const voiceReservations = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE });

  async function callUpstream(method, suffix, bodyObject, action = '') {
    if (!configured) throw new ApiError(503, 'UNCONFIGURED', '真实陪练尚未配置接入凭证，可使用演示练习');
    const url = new URL(`${API_PREFIX}/${PROJECT_ID}/${suffix}`, upstreamOrigin);
    const body = bodyObject == null ? '' : JSON.stringify(bodyObject);
    const headers = signRequest({ method, pathname: url.pathname, body, accessKey, secretKey });
    let response;
    try {
      response = await upstreamFetch(url, {
        method, headers,
        ...(method === 'POST' ? { body } : {}),
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      });
    } catch {
      // Do not surface URL, signature, ticket, or credential-bearing errors.
      throw new ApiError(502, 'UPSTREAM_UNREACHABLE', '无法连接真实陪练服务，请检查网络后重试', true);
    }
    let envelope;
    try { envelope = await response.json(); } catch {
      throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '上游未返回有效 JSON 数据', true);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ApiError(502, 'UPSTREAM_AUTH_REJECTED', '上游接入鉴权未通过');
      }
      throw new ApiError(502, 'UPSTREAM_HTTP_ERROR', `上游请求未成功（HTTP ${response.status}）`, response.status >= 500);
    }
    if (!envelope || ![0, 200].includes(envelope.code)) throw upstreamBusinessError(envelope?.code, action);
    if (!envelope.data || typeof envelope.data !== 'object') {
      throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '上游返回的业务数据格式无效', true);
    }
    return envelope.data;
  }

  async function planDetail(id) {
    return publicPlanDetail(await callUpstream('POST', 'getSparringPlanDetail', { operate_user_id: USER_ID, plan_id: id }), id);
  }

  function localExercise(id) {
    const record = exercises.get(id);
    if (!record) throw new ApiError(403, 'EXERCISE_NOT_LOCAL', '仅可操作本次服务启动后由本页创建的练习');
    return record;
  }

  async function ownedExercise(id) {
    const detail = await callUpstream('GET', `exercise/${id}/detail?operate_user_id=${USER_ID}`);
    if (Number(detail.user_id) !== USER_ID) throw new ApiError(403, 'EXERCISE_NOT_OWNED', '该练习不属于当前学员');
    const planId = allowedPlan(detail.plan_id);
    const record = exercises.get(id);
    if (record && record.planId !== planId) throw new ApiError(403, 'EXERCISE_PLAN_MISMATCH', '练习所属课程不匹配');
    return detail;
  }

  async function history(url) {
    const page = Math.min(1000, positiveInteger(url.searchParams.get('page') ?? 1, '页码'));
    const pageSize = Math.min(20, positiveInteger(url.searchParams.get('pageSize') ?? 10, '每页条数'));
    const planValue = url.searchParams.get('planId');
    const planId = planValue == null ? null : allowedPlan(planValue);
    const data = await callUpstream('POST', 'getExerciseHistory', {
      operate_user_id: USER_ID, page, page_size: pageSize,
      ...(planId == null ? {} : { plan_id: planId }),
    });
    const candidates = (Array.isArray(data.list) ? data.list : []).filter((row) =>
      ALLOWED_PLAN_IDS.has(Number(row.plan_id)) && (planId == null || Number(row.plan_id) === planId));
    const verified = new Array(candidates.length);
    let cursor = 0;
    // The history schema does not contain user_id. Verify each row via detail.
    const workers = Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (cursor < candidates.length) {
        const index = cursor++;
        const row = candidates[index];
        const id = positiveInteger(row.exercise_id, '练习 ID');
        const detail = await ownedExercise(id);
        if (Number(row.plan_id) !== Number(detail.plan_id)) throw new ApiError(403, 'HISTORY_PLAN_MISMATCH', '历史记录课程归属不匹配');
        const status = String(detail.status ?? row.status ?? '');
        const rawScore = row.report?.final_score;
        const finalScore = status === 'evaluated' && typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null;
        verified[index] = {
          exercise_id: id, plan_id: Number(row.plan_id), role_id: Number(row.role_id),
          name: String(row.name ?? ''), status,
          created_at: row.created_at ?? null, updated_at: row.updated_at ?? null,
          finished_at: row.finished_at ?? null, plan_name: String(row.plan_name ?? ''),
          plan_type: String(row.plan_type ?? ''), role_name: String(row.role_name ?? ''),
          dialogue_mode_info: { sparring_role_type: String(row.dialogue_mode_info?.sparring_role_type ?? '') },
          exercise_time: { exercise_last_time: Number(row.exercise_time?.exercise_last_time ?? 0) },
          report: { final_score: finalScore },
        };
      }
    });
    await Promise.all(workers);
    return { list: verified, total: Number(data.total ?? verified.length), page, page_size: pageSize };
  }

  async function api(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJSON(res, 200, { mode: configured ? 'live' : 'unconfigured', projectId: PROJECT_ID, userId: USER_ID });
    }
    if (req.method === 'GET' && url.pathname === '/api/plans') {
      const data = await callUpstream('POST', 'getStudentPracticeInfo', { operate_user_id: USER_ID });
      const plans = new Map();
      for (const [field, type] of [['pending_practice_list', 'practice'], ['pending_exam_list', 'exam'], ['finished_exam_list', 'exam']]) {
        for (const row of Array.isArray(data[field]) ? data[field] : []) {
          if (ALLOWED_PLAN_IDS.has(Number(row.id))) plans.set(Number(row.id), normalizedPlan(row, type));
        }
      }
      return sendJSON(res, 200, { plans: [...plans.values()] });
    }
    const planRoute = /^\/api\/plans\/(\d+)$/.exec(url.pathname);
    if (req.method === 'GET' && planRoute) return sendJSON(res, 200, await planDetail(allowedPlan(planRoute[1])));
    if (req.method === 'POST' && url.pathname === '/api/exercises') {
      const body = await requestBody(req);
      const planId = allowedPlan(body.planId);
      const roleId = positiveInteger(body.roleId, '角色 ID');
      const plan = await planDetail(planId);
      if (plan.status !== 'active') throw new ApiError(409, 'PLAN_NOT_ACTIVE', '该课程尚未开放练习');
      if (!plan.roles.some((role) => role.id === roleId)) throw new ApiError(400, 'ROLE_NOT_IN_PLAN', '所选角色不属于该课程');
      if (!['text', 'virtual_streaming_dialogue'].includes(plan.dialogueMode)) {
        throw new ApiError(409, 'DIALOGUE_PROTOCOL_UNAVAILABLE', '本课程的对话协议尚未接入');
      }
      const data = await callUpstream('POST', 'startSparringExercise', {
        operate_user_id: USER_ID, plan_id: planId, role_id: roleId,
      }, 'start');
      const id = positiveInteger(data.exercise_id, '练习 ID');
      const record = { id, planId, roleId, name: String(data.name ?? ''), dialogueMode: plan.dialogueMode, ending: false, ended: false };
      exercises.set(id, record);
      return sendJSON(res, 201, exerciseSummary(data, record));
    }
    if (req.method === 'GET' && url.pathname === '/api/history') return sendJSON(res, 200, await history(url));
    const exerciseRoute = /^\/api\/exercises\/(\d+)(?:\/(end|report))?$/.exec(url.pathname);
    if (exerciseRoute) {
      const id = positiveInteger(exerciseRoute[1], '练习 ID');
      const action = exerciseRoute[2];
      if (req.method === 'GET' && !action) {
        const data = await ownedExercise(id);
        return sendJSON(res, 200, exerciseSummary(data, exercises.get(id)));
      }
      if (req.method === 'GET' && action === 'report') {
        await ownedExercise(id);
        return sendJSON(res, 200, publicReportDetail(await callUpstream('GET', `exercise/${id}/getReport?operate_user_id=${USER_ID}`, null, 'report')));
      }
      if (req.method === 'POST' && action === 'end') {
        await requestBody(req);
        const record = localExercise(id);
        if (record.ending) throw new ApiError(409, 'END_IN_PROGRESS', '正在结束练习，请稍候');
        if (record.ended) return sendJSON(res, 200, { id, exerciseId: id, status: record.endStatus });
        record.ending = true;
        try {
          await ownedExercise(id);
          const data = await callUpstream('POST', 'endSparringExercise', { operate_user_id: USER_ID, exercise_id: id });
          record.ended = true;
          record.endStatus = String(data.status ?? 'finished');
          activeVoice.get(id)?.client.close(1000, '练习已结束');
          return sendJSON(res, 200, exerciseSummary(data, record));
        } finally {
          record.ending = false;
        }
      }
    }
    throw new ApiError(404, 'API_NOT_FOUND', '接口不存在');
  }

  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8' };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:* ws://localhost:* ${publicSocketOrigin}; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
    try {
      if (!localRequest(req)) throw new ApiError(403, 'LOCAL_HOST_REQUIRED', '本服务仅接受本机地址访问');
      if (req.method === 'POST' && !sameOrigin(req, acceptedPublicOrigin)) throw new ApiError(403, 'ORIGIN_REJECTED', '请求来源不被允许');
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      const path = resolve(publicRoot, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (!path.startsWith(`${resolve(publicRoot)}${sep}`)) throw new ApiError(403, 'PATH_REJECTED', '文件路径不被允许');
      let fileStat;
      try {
        fileStat = await stat(path);
        if (!fileStat.isFile()) throw new Error();
      } catch {
        throw new ApiError(404, 'FILE_NOT_FOUND', '页面资源不存在');
      }
      const headers = {
        'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes',
        'Last-Modified': fileStat.mtime.toUTCString(),
      };
      const range = req.headers.range == null ? undefined : parseByteRange(req.headers.range, fileStat.size);
      if (range === null) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${fileStat.size}`, 'Content-Length': 0 });
        return res.end();
      }
      res.writeHead(range ? 206 : 200, {
        ...headers, 'Content-Length': range ? range.end - range.start + 1 : fileStat.size,
        ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${fileStat.size}` } : {}),
      });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(path, range || undefined);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (!res.headersSent) sendError(res, error);
      else res.end();
    }
  });

  function rejectUpgrade(socket, status, message) {
    if (socket.destroyed) return;
    const body = JSON.stringify({ error: { message } });
    socket.end(`HTTP/1.1 ${status} Rejected\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  server.on('upgrade', async (req, socket, head) => {
    let id;
    let upstream;
    let handedOff = false;
    let reserved = false;
    socket.on('error', () => {});
    try {
      if (!sameOrigin(req, acceptedPublicOrigin)) throw new ApiError(403, 'ORIGIN_REJECTED', '语音连接来源不被允许');
      const url = new URL(req.url, `http://${req.headers.host}`);
      const route = /^\/api\/voice\/(\d+)$/.exec(url.pathname);
      const requestedTransport = url.searchParams.get('transport');
      if (!route || [...url.searchParams.keys()].some((key) => key !== 'transport') ||
        url.searchParams.getAll('transport').length > 1 ||
        (requestedTransport !== null && requestedTransport !== 'text')) {
        throw new ApiError(404, 'VOICE_ROUTE_NOT_FOUND', '对话连接地址无效');
      }
      id = positiveInteger(route[1], '练习 ID');
      const record = localExercise(id);
      if (record.ended || record.ending) throw new ApiError(409, 'EXERCISE_ENDED', '练习已结束或正在结束');
      if (!['text', 'virtual_streaming_dialogue'].includes(record.dialogueMode)) throw new ApiError(409, 'DIALOGUE_PROTOCOL_UNAVAILABLE', '本课程的对话协议尚未接入');
      if (activeVoice.has(id) || voiceReservations.has(id)) throw new ApiError(409, 'VOICE_ALREADY_CONNECTED', '该练习已有语音连接');
      voiceReservations.add(id);
      reserved = true;
      const detail = await ownedExercise(id);
      if (detail.status !== 'running') throw new ApiError(409, 'EXERCISE_NOT_RUNNING', '练习尚未就绪，请等待后重试');
      const ticketData = await callUpstream('POST', 'getWsTicket', { operate_user_id: USER_ID, exercise_id: id });
      if (typeof ticketData.ticket !== 'string' || !ticketData.ticket) throw new ApiError(502, 'TICKET_MISSING', '上游未返回可用语音票据', true);
      if (socket.destroyed) return;
      const transportMode = requestedTransport ?? record.dialogueMode;
      const upstreamPath = transportMode === 'text'
        ? `/datafinder/wscompass/api/ws/openapi/listen_and_act_binary/${id}`
        : `/datafinder/wscompass/api/ws/openapi/sparring/chat_steam/${id}`;
      const upstreamURL = new URL(upstreamPath, upstreamOrigin);
      upstreamURL.protocol = upstreamURL.protocol === 'https:' ? 'wss:' : 'ws:';
      upstreamURL.searchParams.set('ticket', ticketData.ticket);
      upstream = connectWebSocket(upstreamURL, { handshakeTimeout: 15_000, maxPayload: MAX_WS_MESSAGE });
      // Keep a sanitized listener throughout handshaking and cancellation.
      upstream.on('error', () => {});
      // S_READY may arrive with the upstream upgrade, before our browser upgrade.
      // Attach now and buffer only until the local socket can receive it.
      let localClient;
      let pendingBytes = 0;
      const pendingMessages = [];
      const closeBoth = (message = '实战连接已断开') => {
        if (localClient?.readyState === WebSocket.OPEN) localClient.close(1011, message);
        if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(upstream.readyState)) upstream.close();
      };
      const forward = (data, binary) => {
        if (!binary) return closeBoth('上游对话消息格式不匹配');
        if (!localClient) {
          pendingBytes += data.byteLength;
          if (pendingBytes > MAX_WS_BUFFER) return closeBoth('对话网络拥堵，请重新连接');
          pendingMessages.push(data);
          return;
        }
        if (localClient.readyState !== WebSocket.OPEN) return;
        if (localClient.bufferedAmount > MAX_WS_BUFFER) return closeBoth('对话网络拥堵，请重新连接');
        localClient.send(data, { binary: true }, (error) => { if (error) closeBoth(); });
      };
      upstream.on('message', forward);
      await new Promise((resolveOpen, rejectOpen) => {
        const timer = setTimeout(() => rejectOpen(new Error()), 16_000);
        const onOpen = () => { cleanup(); resolveOpen(); };
        const onFailure = () => { cleanup(); rejectOpen(new Error()); };
        function cleanup() {
          clearTimeout(timer);
          upstream.off('open', onOpen);
          upstream.off('error', onFailure);
          upstream.off('close', onFailure);
        }
        upstream.once('open', onOpen);
        upstream.once('error', onFailure);
        upstream.once('close', onFailure);
      });
      if (socket.destroyed) { upstream.close(); return; }
      if (upstream.readyState !== WebSocket.OPEN) throw new ApiError(502, 'DIALOGUE_DISCONNECTED', '上游对话连接已断开，请重试', true);
      if (record.ended || record.ending) throw new ApiError(409, 'EXERCISE_ENDED', '练习已结束或正在结束');
      wss.handleUpgrade(req, socket, head, (client) => {
        handedOff = true;
        localClient = client;
        activeVoice.set(id, { client, upstream });
        client.on('message', (data, binary) => {
          if (!binary) { client.close(1003, '仅接受二进制语音帧'); return; }
          if (upstream.readyState !== WebSocket.OPEN) return closeBoth();
          if (upstream.bufferedAmount > MAX_WS_BUFFER) return closeBoth('语音网络拥堵，请重新连接');
          upstream.send(data, { binary: true }, (error) => { if (error) closeBoth(); });
        });
        client.on('error', () => closeBoth());
        upstream.on('error', () => closeBoth('无法连接真实语音服务'));
        upstream.on('close', () => {
          if (client.readyState === WebSocket.OPEN) client.close(1011, '真实语音服务已断开');
        });
        client.on('close', () => {
          activeVoice.delete(id);
          if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(upstream.readyState)) upstream.close();
          // Closing a socket must never end or evaluate the remote exercise.
        });
        for (const data of pendingMessages) forward(data, true);
        pendingMessages.length = 0;
      });
    } catch (error) {
      rejectUpgrade(socket, error instanceof ApiError ? error.status : 502,
        error instanceof ApiError ? error.message : '真实语音连接失败，请稍后重试');
    } finally {
      if (reserved) voiceReservations.delete(id);
      if (!handedOff && upstream && [WebSocket.OPEN, WebSocket.CONNECTING].includes(upstream.readyState)) {
        upstream.on('error', () => {});
        upstream.close();
      }
    }
  });

  return {
    server,
    async close() {
      for (const { client, upstream } of activeVoice.values()) { client.terminate(); upstream.terminate(); }
      activeVoice.clear();
      wss.close();
      await new Promise((done) => server.close(done));
    },
  };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '.env.local'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('无法读取本机 .env.local 配置，请检查文件格式和权限');
  }
  const port = Number(process.env.PORT ?? 5317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1 至 65535 的整数');
  const application = createApplication();
  application.server.listen(port, '127.0.0.1', () => {
    console.log(`玉柴学习 H5：http://127.0.0.1:${port}`);
  });
  application.server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? '本地端口已被占用，请更换 PORT 后启动' : '本地服务启动失败');
    process.exitCode = 1;
  });
}
