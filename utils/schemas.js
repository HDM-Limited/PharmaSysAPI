const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ObjectId');

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const emailSchema = z.string().email().toLowerCase().trim();

const phoneSchema = z.string().min(7).max(20);

const passwordSchema = z.string().min(8).max(128);

const idParam = z.object({ id: objectId });

module.exports = {
  z,
  objectId,
  paginationSchema,
  emailSchema,
  phoneSchema,
  passwordSchema,
  idParam,
};