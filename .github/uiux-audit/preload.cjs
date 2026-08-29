const { contextBridge } = require('electron');

const session = { sessionId: 'audit-session', libraryId: 'audit-library', schemaVersion: 4, name: 'A Very Motherly Christmas' };
const roots = [
  { rootId: 'root-1', displayName: '01 · Visual Research', rootKind: 'linked', state: 'ready', authorized: true, activeJobId: null, observedCount: 1864, unsupportedCount: 73 },
  { rootId: 'root-2', displayName: '02 · Client Materials', rootKind: 'linked', state: 'needs_permission', authorized: false, activeJobId: null, observedCount: 214, unsupportedCount: 6 },
];
const collections = [
  { collectionId: 'collection-1', name: 'Cover contenders', assetCount: 18, revision: 1 },
  { collectionId: 'collection-2', name: 'Family warmth', assetCount: 31, revision: 1 },
  { collectionId: 'collection-3', name: 'Christmas texture', assetCount: 46, revision: 1 },
];
const palette = ['#f6b8a8','#9fb9ff','#f6d75f','#b7e3cc','#d5b7ef','#f4a261','#8ecae6','#f28482','#84a59d','#cdb4db','#e9c46a','#a8dadc'];
const categories = ['Cover','Character','World','Family','Texture','Lighting'];
const tags = [['warm','portrait'],['night','snow'],['family','table'],['red','texture'],['quiet','interior'],['christmas','lights']];
const usages = [['Cover'],['Slide 07'],[],['Mood'],['Characters'],['World']];
const names = [
  'Mother and daughter at the doorway','Blue-hour snowfall on the brownstone','The table before everyone arrives','Crushed velvet and wrapping paper','A quiet kitchen after midnight','Christmas lights through wet glass',
  'Family portrait, imperfect smiles','Warm hallway with an open door','Red coat against winter blue','Living room after the argument','Hands passing a serving dish','Snow caught in streetlight',
  'Gold ribbon macro study','Three generations on the sofa','Empty chair at the table','Window condensation and city lights','Holiday store window reflection','Late-night phone call',
  'Brownstone exterior, first snow','Family album contact sheet','Kitchen steam and laughter','Gift paper, torn not folded','Stairwell in tungsten light','Morning after Christmas'
];
const assets = names.map((name, index) => ({
  assetId: `asset-${index + 1}`,
  locationId: `location-${index + 1}`,
  displayName: name,
  relativeDisplayPath: `Research/${categories[index % categories.length]}/${String(index + 1).padStart(2,'0')}-${name.toLowerCase().replaceAll(' ','-')}.jpg`,
  mediaFamily: index === 22 ? 'design' : 'image', mimeType: index === 22 ? 'image/vnd.adobe.photoshop' : 'image/jpeg', extension: index === 22 ? 'psd' : 'jpg',
  byteSize: 720000 + index * 183000, category: categories[index % categories.length],
  previewKind: index === 22 ? 'none' : 'image', availability: index === 22 ? 'unsupported' : index === 23 ? 'offline_volume' : 'present',
  reviewState: index % 7 === 0 ? 'keep' : index % 5 === 0 ? 'maybe' : index % 11 === 0 ? 'reject' : 'unreviewed',
  customTitle: null, tags: tags[index % tags.length], usedIn: usages[index % usages.length],
  previewAssetIds: index % 4 === 0 ? [`asset-${(index + 2) % 20 + 1}`, `asset-${(index + 3) % 20 + 1}`, `asset-${(index + 4) % 20 + 1}`] : [],
  createdAtMs: 1700000000000 + index * 60000, revision: 1,
}));
const detailFor = (asset) => ({
  assetId: asset.assetId, locationId: asset.locationId, originalDisplayName: asset.displayName,
  relativeDisplayPath: asset.relativeDisplayPath, mediaFamily: asset.mediaFamily, mimeType: asset.mimeType,
  extension: asset.extension, byteSize: asset.byteSize, category: asset.category, previewKind: asset.previewKind,
  availability: asset.availability, reviewState: asset.reviewState, customTitle: asset.customTitle,
  note: asset.assetId === 'asset-1' ? 'Tender but not sentimental. The doorway gives us separation and invitation in the same frame.' : null,
  tags: asset.tags, usedIn: asset.usedIn, revision: asset.revision,
  collectionIds: asset.assetId === 'asset-1' ? ['collection-1','collection-2'] : [],
});
const counts = (items, getter) => [...items.reduce((map, item) => { for (const value of getter(item)) map.set(value,(map.get(value)||0)+1); return map; }, new Map())]
  .map(([value,count]) => ({ value, count })).sort((a,b) => b.count-a.count || a.value.localeCompare(b.value));
const facetsFor = (items) => ({
  categories: counts(items,a=>[a.category]), extensions: counts(items,a=>[a.extension].filter(Boolean)),
  mediaFamilies: counts(items,a=>[a.mediaFamily]), tags: counts(items,a=>a.tags), usedIn: counts(items,a=>a.usedIn),
});
const preferences = { interfaceScale: 1, thumbnailDensity: 220, previewZoom: 1, viewMode: 'grid', multiThumbnailPreviews: false, autoRescan: false };
const filterAssets = (query) => {
  let items = [...assets];
  const includes = (selected, values) => !selected.length || selected.every(value => values.includes(value));
  if (query.search) { const q=query.search.toLowerCase(); items=items.filter(a => [a.displayName,a.relativeDisplayPath,a.category,a.extension,...a.tags,...a.usedIn].join(' ').toLowerCase().includes(q)); }
  if (query.reviewStates.length) items=items.filter(a=>query.reviewStates.includes(a.reviewState));
  if (query.availability.length) items=items.filter(a=>query.availability.includes(a.availability));
  if (query.categories.length) items=items.filter(a=>includes(query.categories,[a.category]));
  if (query.extensions.length) items=items.filter(a=>includes(query.extensions,[a.extension]));
  if (query.mediaFamilies.length) items=items.filter(a=>includes(query.mediaFamilies,[a.mediaFamily]));
  if (query.tags.length) items=items.filter(a=>includes(query.tags,a.tags));
  if (query.usedIn.length) items=items.filter(a=>includes(query.usedIn,a.usedIn));
  const sorters = {
    name_ascending:(a,b)=>a.displayName.localeCompare(b.displayName), name_descending:(a,b)=>b.displayName.localeCompare(a.displayName),
    created_ascending:(a,b)=>a.createdAtMs-b.createdAtMs, created_descending:(a,b)=>b.createdAtMs-a.createdAtMs,
    size_ascending:(a,b)=>a.byteSize-b.byteSize, size_descending:(a,b)=>b.byteSize-a.byteSize,
    review_state:(a,b)=>a.reviewState.localeCompare(b.reviewState),
  };
  items.sort(sorters[query.sort] || sorters.created_ascending);
  return items;
};
const svgFor = (assetId) => {
  const index = Math.max(0, Number(assetId.split('-')[1] || 1)-1); const a=palette[index%palette.length]; const b=palette[(index+4)%palette.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="820" viewBox="0 0 1200 820"><rect width="1200" height="820" fill="${a}"/><path d="M0 650L340 270L650 610L890 170L1200 550V820H0Z" fill="${b}" opacity=".78"/><circle cx="${180+(index%5)*180}" cy="${150+(index%3)*110}" r="${95+(index%4)*28}" fill="#171717" opacity=".78"/><rect x="60" y="60" width="1080" height="700" fill="none" stroke="#171717" stroke-width="14"/><text x="80" y="745" font-family="Arial,sans-serif" font-size="46" font-weight="700" fill="#171717">${assetId.toUpperCase()}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

contextBridge.exposeInMainWorld('referenceLibrary', {
  version: 4,
  createLibrary: async () => session,
  openLibrary: async () => session,
  completeOpenIntent: async () => session,
  readPreferences: async () => ({...preferences}),
  writePreferences: async patch => ({...Object.assign(preferences, patch)}),
  closeLibrary: async () => {},
  chooseRoot: async () => null,
  listRoots: async () => roots.map(root => ({...root})),
  reauthorizeRoot: async () => ({ session, root: {...roots[1], authorized:true, state:'ready'} }),
  scanRoot: async (_sessionId, rootId) => ({rootId,jobId:'job-1'}),
  cancelJob: async () => {},
  queryJobs: async () => ({offset:0,limit:100,total:0,items:[],nextOffset:null}),
  queryAssets: async ({offset,limit,query}) => { const items=filterAssets(query); return {offset,limit,total:items.length,items:items.slice(offset,offset+limit).map(a=>({...a})),nextOffset:offset+limit<items.length?offset+limit:null,libraryRevision:1,facets:facetsFor(items)}; },
  getAsset: async (_sessionId,id) => detailFor(assets.find(a=>a.assetId===id)),
  updateAsset: async input => { const a=assets.find(a=>a.assetId===input.assetId); if(input.patch.reviewState)a.reviewState=input.patch.reviewState; a.revision++; return {asset:detailFor(a),libraryRevision:2}; },
  listCollections: async () => collections.map(collection => ({...collection})),
  createCollection: async (_sessionId,name)=>({collectionId:'new',name,assetCount:0,revision:1}),
  renameCollection: async (_sessionId,id,_revision,name)=>({collectionId:id,name,assetCount:0,revision:2}),
  deleteCollection: async()=>{},
  setCollectionMembership: async ({collectionId,assetIds})=>({collectionId,affected:assetIds.length,libraryRevision:2}),
  assetResourceUrl: ({assetId}) => svgFor(assetId),
  revealLocation: async()=>{}, openLocation: async()=>{}, copyLocationPath: async()=>{}, queryCapabilities: async()=>[], restartCore: async()=>session,
  subscribe: () => () => {},
});
