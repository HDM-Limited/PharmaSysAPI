const crypto = require('crypto');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created } = require('../../utils/apiResponse');
const { ApiError } = require('../../utils/apiError');
const PlatformSetting = require('../../models/admin/PlatformSetting');
const AdminAction = require('../../models/admin/AdminAction');

const VALID_TYPES = ['windows', 'macos', 'linux', 'android', 'ios'];

function normalizeLink(link) {
  if (!link) return link;
  const trimmed = String(link).trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

function sanitizeItem(item) {
  return {
    id: item.id || crypto.randomUUID(),
    name: String(item.name || '').trim(),
    type: VALID_TYPES.includes(item.type) ? item.type : 'windows',
    version: String(item.version || '').trim(),
    arch: item.arch || 'x64',
    link: normalizeLink(item.link || ''),
    size: item.size || null,
    checksum: item.checksum || null,
    minOS: item.minOS || null,
    releaseNotes: item.releaseNotes || '',
    enabled: item.enabled !== false,
    position: Number.isFinite(item.position) ? item.position : 0,
  };
}

async function loadDownloads() {
  const doc = await PlatformSetting.findOne({ key: 'downloads' }).lean();
  const list = Array.isArray(doc?.value) ? doc.value : [];
  return [...list].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

async function saveDownloads(list, adminId) {
  await PlatformSetting.setValue('downloads', list, adminId);
}

const list = asyncHandler(async (_req, res) => {
  const items = await loadDownloads();
  return ok(res, items);
});

const create = asyncHandler(async (req, res) => {
  const { name, version, link, type } = req.body;
  if (!name || !version || !link) {
    throw ApiError.badRequest('MISSING_FIELDS', 'name, version, and link are required');
  }
  if (type && !VALID_TYPES.includes(type)) {
    throw ApiError.badRequest('INVALID_TYPE', 'Invalid platform type');
  }

  const items = await loadDownloads();

  const item = sanitizeItem({
    ...req.body,
    id: crypto.randomUUID(),
    position: items.length,
  });

  items.push(item);
  await saveDownloads(items, req.admin.id);

  await AdminAction.create({
    adminId: req.admin.id,
    action: 'downloads.create',
    metadata: { id: item.id, name: item.name },
    ip: req.ip,
  }).catch(() => {});

  return created(res, item);
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const items = await loadDownloads();
  const idx = items.findIndex((d) => d.id === id);
  if (idx === -1) throw ApiError.notFound('DOWNLOAD_NOT_FOUND', 'Download not found');

  const allowed = [
    'name', 'type', 'version', 'arch', 'link', 'size', 'checksum',
    'minOS', 'releaseNotes', 'enabled', 'position',
  ];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  if (patch.type && !VALID_TYPES.includes(patch.type)) {
    throw ApiError.badRequest('INVALID_TYPE', 'Invalid platform type');
  }
  if (patch.link) patch.link = normalizeLink(patch.link);

  items[idx] = { ...items[idx], ...patch };
  await saveDownloads(items, req.admin.id);

  await AdminAction.create({
    adminId: req.admin.id,
    action: 'downloads.update',
    metadata: { id, keys: Object.keys(patch) },
    ip: req.ip,
  }).catch(() => {});

  return ok(res, items[idx]);
});

const toggle = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const items = await loadDownloads();
  const idx = items.findIndex((d) => d.id === id);
  if (idx === -1) throw ApiError.notFound('DOWNLOAD_NOT_FOUND', 'Download not found');

  items[idx].enabled = !items[idx].enabled;
  await saveDownloads(items, req.admin.id);

  await AdminAction.create({
    adminId: req.admin.id,
    action: 'downloads.toggle',
    metadata: { id, enabled: items[idx].enabled },
    ip: req.ip,
  }).catch(() => {});

  return ok(res, items[idx]);
});

const remove = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const items = await loadDownloads();
  const next = items.filter((d) => d.id !== id);
  if (next.length === items.length) {
    throw ApiError.notFound('DOWNLOAD_NOT_FOUND', 'Download not found');
  }
  next.forEach((d, i) => { d.position = i; });
  await saveDownloads(next, req.admin.id);

  await AdminAction.create({
    adminId: req.admin.id,
    action: 'downloads.delete',
    metadata: { id },
    ip: req.ip,
  }).catch(() => {});

  return ok(res, { deleted: true });
});

const reorder = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) throw ApiError.badRequest('INVALID_INPUT', 'ids array required');

  const items = await loadDownloads();
  const map = new Map(items.map((d) => [d.id, d]));
  ids.forEach((id, i) => {
    const entry = map.get(id);
    if (entry) entry.position = i;
  });

  await saveDownloads(items, req.admin.id);
  return ok(res, [...items].sort((a, b) => a.position - b.position));
});

module.exports = { list, create, update, toggle, remove, reorder };