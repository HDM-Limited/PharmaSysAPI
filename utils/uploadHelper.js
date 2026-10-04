const { cloudinary, FOLDERS } = require('../config/cloudinary');
const { ApiError } = require('./apiError');

async function uploadBuffer(buffer, { folder, publicId, resourceType = 'auto' } = {}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw ApiError.badRequest('INVALID_BUFFER', 'Buffer is required');
  }

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

async function deleteByPublicId(publicId, resourceType = 'image') {
  if (!publicId) return null;
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

function buildSignedUploadParams({ folder, publicId, resourceType = 'image', timestamp } = {}) {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const paramsToSign = {
    timestamp: ts,
    folder,
    public_id: publicId,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    require('../config/env').env.cloudinary.apiSecret
  );

  return {
    timestamp: ts,
    signature,
    folder,
    public_id: publicId,
    resource_type: resourceType,
    cloud_name: require('../config/env').env.cloudinary.cloudName,
    api_key: require('../config/env').env.cloudinary.apiKey,
  };
}

module.exports = {
  uploadBuffer,
  uploadStream,
  deleteByPublicId,
  buildSignedUploadParams,
  FOLDERS,
};