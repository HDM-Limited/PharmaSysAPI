const mongoose = require('mongoose');
const { getTenant, getAdmin, runAsTenant } = require('./context');

function tenantScope(schema, options = {}) {
  const { branchScoped = false, allowGlobal = true } = options;

  schema.add({
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
  });

  if (branchScoped) {
    schema.add({
      branchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Branch',
        required: true,
        index: true,
      },
    });
  }

  schema.pre('validate', function (next) {
    if (this.tenantId) return next();

    const ctx = getTenant();
    if (ctx && ctx.tenantId) {
      this.tenantId = ctx.tenantId;
      if (branchScoped && !this.branchId && ctx.branchId) {
        this.branchId = ctx.branchId;
      }
    }
    next();
  });

  const injectFilter = function () {
    // Super admin context — cross-tenant query allowed
    if (getAdmin()?.isAdmin) return;

    const filter = this.getFilter();
    if (filter.__allowGlobal === true && allowGlobal) {
      delete filter.__allowGlobal;
      return;
    }

    const ctx = getTenant();
    if (!ctx || !ctx.tenantId) {
      throw new Error('TENANT_CONTEXT_MISSING: refusing to query without tenant');
    }

    this.where({ tenantId: ctx.tenantId });
    if (branchScoped && ctx.role !== 'owner' && ctx.branchId) {
      this.where({ branchId: ctx.branchId });
    }
  };

  const readHooks = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndReplace',
    'countDocuments',
    'estimatedDocumentCount',
    'distinct',
  ];

  const writeHooks = [
    'updateMany',
    'updateOne',
    'deleteMany',
    'deleteOne',
    'replaceOne',
  ];

  readHooks.forEach((h) => schema.pre(h, injectFilter));
  writeHooks.forEach((h) => schema.pre(h, injectFilter));

  schema.statics.withGlobal = function (fn) {
    return runAsTenant({ tenantId: '__global__', allowGlobal: true }, fn);
  };
}

module.exports = { tenantScope };