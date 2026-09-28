# Asset build

gltf-transform steps:
- meshopt compression and quantisation;
- KTX2 textures (UASTC for hero maps, ETC1S otherwise);
- sparse morph targets;
- LODs;
- per-chapter chunking into `apps/site/public/assets`.

Emits a payload report that is checked against the budgets in plan §9.
