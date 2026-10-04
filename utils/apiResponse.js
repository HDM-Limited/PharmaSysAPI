function ok(res, data = null, meta = null) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(200).json(body);
}

function created(res, data = null, meta = null) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(201).json(body);
}

function noContent(res) {
  return res.status(204).send();
}

function paginated(res, items, page, limit, total) {
  const pages = limit > 0 ? Math.ceil(total / limit) : 0;
  return res.status(200).json({
    success: true,
    data: items,
    meta: {
      page,
      limit,
      total,
      pages,
      hasNext: page < pages,
      hasPrev: page > 1,
    },
  });
}

module.exports = { ok, created, noContent, paginated };