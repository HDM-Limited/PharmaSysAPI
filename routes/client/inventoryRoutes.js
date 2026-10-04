const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/inventoryController');
const { authorize } = require('../../middleware/client/authorize');

/* Drugs */
router.get('/drugs', authorize('inventory.view'), ctrl.listDrugs);
router.post('/drugs', authorize('drugs.create'), ctrl.createDrug);
router.get('/drugs/:id', authorize('inventory.view'), ctrl.getDrug);
router.patch('/drugs/:id', authorize('drugs.edit'), ctrl.updateDrug);
router.delete('/drugs/:id', authorize('drugs.edit'), ctrl.removeDrug);
router.post('/drugs/:id/batches', authorize('inventory.receive'), ctrl.addBatch);

/* Batches */
router.get('/batches', authorize('inventory.view'), ctrl.listBatches);
router.patch('/batches/:id', authorize('inventory.adjust'), ctrl.updateBatch);
router.delete('/batches/:id', authorize('inventory.adjust'), ctrl.removeBatch);

/* Stock */
router.post('/adjust', authorize('inventory.adjust'), ctrl.adjust);
router.get('/movements', authorize('inventory.view'), ctrl.listMovements);
router.get('/low-stock', authorize('inventory.view'), ctrl.lowStock);
router.get('/expiring', authorize('inventory.view'), ctrl.expiring);

module.exports = router;