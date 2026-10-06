'use strict';

const multer = require('multer');
const { AppError } = require('../errors/app-error');
const { ALLOWED_MIME, MAX_BYTES } = require('./storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(AppError.validation('Only image uploads are allowed'));
      return;
    }
    cb(null, true);
  },
});

function singleImageUpload(fieldName = 'file') {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(AppError.validation('File exceeds 2MB limit'));
        }
        return next(AppError.validation(err.message));
      }
      return next(err);
    });
  };
}

module.exports = { singleImageUpload };
