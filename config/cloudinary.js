const cloudinary = require('cloudinary').v2;
const { env } = require('./env');

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
  secure: true,
});

const FOLDERS = {
  tenantLogo: (tenantId) => `pharmasys/tenants/${tenantId}/logo`,
  tenantReceipt: (tenantId, yyyymm) => `pharmasys/tenants/${tenantId}/receipts/${yyyymm}`,
  tenantDrug: (tenantId) => `pharmasys/tenants/${tenantId}/drugs`,
  tenantExport: (tenantId) => `pharmasys/tenants/${tenantId}/exports`,
  tenantImport: (tenantId) => `pharmasys/tenants/${tenantId}/imports`,
  platformLogo: () => 'pharmasys/system/logos',
  backups: () => 'pharmasys/backups',
  legal: () => 'pharmasys/system/legal',
};

const enabled = Boolean(
  env.cloudinary.cloudName &&
  env.cloudinary.apiKey &&
  env.cloudinary.apiSecret
);

async function uploadBuffer(buffer, { folder, publicId, resourceType = 'auto' } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('uploadBuffer requires a Buffer');
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: resourceType },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          publicId: result.public_id,
          url: result.secure_url,
          bytes: result.bytes,
          format: result.format,
        });
      }
    );
    stream.end(buffer);
  });
}

async function uploadStream(readable, { folder, publicId, resourceType = 'auto' } = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: resourceType },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          publicId: result.public_id,
          url: result.secure_url,
          bytes: result.bytes,
        });
      }
    );
    readable.pipe(stream);
    readable.on('error', reject);
  });
}

async function destroy(publicId, resourceType = 'image') {
  if (!publicId) return null;
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

function signedUploadParams({ folder, publicId, resourceType = 'image' } = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = { timestamp, folder, public_id: publicId };
  const signature = cloudinary.utils.api_sign_request(paramsToSign, env.cloudinary.apiSecret);
  return {
    timestamp,
    signature,
    folder,
    public_id: publicId,
    resource_type: resourceType,
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    upload_preset: env.cloudinary.uploadPreset,
  };
}

module.exports = {
  cloudinary,
  FOLDERS,
  enabled,
  uploadBuffer,
  uploadStream,
  destroy,
  signedUploadParams,
};