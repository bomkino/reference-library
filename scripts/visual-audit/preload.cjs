const { contextBridge } = require("electron");

const baseSession = {
  sessionId: "audit-session",
  libraryId: "audit-library",
  schemaVersion: 4,
  name: "A Very Motherly Christmas",
};

const roots = [
  {
    rootId: "root-1",
    displayName: "01 · Visual Research",
    rootKind: "linked",
    state: "ready",
    authorized: true,
    activeJobId: null,
    observedCount: 1864,
    unsupportedCount: 73,
  },
  {
    rootId: "root-2",
    displayName: "02 · Client Materials",
    rootKind: "linked",
    state: "needs_permission",
    authorized: false,
    activeJobId: null,
    observedCount: 214,
    unsupportedCount: 6,
  },
];

const collections = [
  { collectionId: "collection-1", name: "Cover contenders", assetCount: 18, revision: 1 },
  { collectionId: "collection-2", name: "Family warmth", assetCount: 31, revision: 1 },
  { collectionId: "collection-3", name: "Christmas texture", assetCount: 46, revision: 1 },
];

const palette = [
  "#f6b8a8", "#9fb9ff", "#f6d75f", "#b7e3cc", "#d5b7ef", "#f4a261",
  "#8ecae6", "#f28482", "#84a59d", "#cdb4db", "#e9c46a", "#a8dadc",
];
const categories = ["Cover", "Character", "World", "Family", "Texture", "Lighting"];
const tagSets = [
  ["warm", "portrait"], ["night", "snow"], ["family", "table"],
  ["red", "texture"], ["quiet", "interior"], ["christmas", "lights"],
];
const usageSets = [["Cover"], ["Slide 07"], [], ["Mood"], ["Characters"], ["World"]];
const names = [
  "Mother and daughter at the doorway",
  "Blue-hour snowfall on the brownstone",
  "The table before everyone arrives",
  "Crushed velvet and wrapping paper",
  "A quiet kitchen after midnight",
  "Christmas lights through wet glass",
  "Family portrait, imperfect smiles",
  "Warm hallway with an open door",
  "Red coat against winter blue",
  "Living room after the argument",
  "Hands passing a serving dish",
  "Snow caught in streetlight",
  "Gold ribbon macro study",
  "Three generations on the sofa",
  "Empty chair at the table",
  "Window condensation and city lights",
  "Holiday store window reflection",
  "Late-night phone call",
  "Brownstone exterior, first snow",
  "Family album contact sheet",
  "Kitchen steam and laughter",
  "Gift paper, torn not folded",
  "Stairwell in tungsten light",
  "Morning after Christmas",
];

const assets = names.map((displayName, index) => ({
  assetId: `asset-${index + 1}`,
  locationId: `location-${index + 1}`,
  displayName,
  relativeDisplayPath: `Research/${categories[index % categories.length]}/${String(index + 1).padStart(2, "0")}-${displayName.toLowerCase().replaceAll(" ", "-")}.jpg`,
  mediaFamily: index === 22 ? "design" : "image",
  mimeType: index === 22 ? "image/vnd.adobe.photoshop" : "image/jpeg",
  extension: index === 22 ? "psd" : "jpg",
  byteSize: 720000 + index * 183000,
  category: categories[index % categories.length],
  previewKind: index === 22 ? "none" : "image",
  availability: index === 22 ? "unsupported" : index === 23 ? "offline_volume" : "present",
  reviewState: index % 7 === 0 ? "keep" : index % 5 === 0 ? "maybe" : index % 11 === 0 ? "reject" : "unreviewed",
  customTitle: null,
  tags: [...tagSets[index % tagSets.length]],
  usedIn: [...usageSets[index % usageSets.length]],
  previewAssetIds: index % 4 === 0
    ? [`asset-${(index + 2) % 20 + 1}`, `asset-${(index + 3) % 20 + 1}`, `asset-${(index + 4) % 20 + 1}`]
    : [],
  createdAtMs: 1700000000000 + index * 60000,
  revision: 1,
}));

const detailFor = (asset) => ({
  ...asset,
  originalDisplayName: asset.displayName,
  note: asset.assetId === "asset-1"
    ? "Tender but not sentimental. The doorway gives us separation and invitation in the same frame."
    : null,
  collectionIds: asset.assetId === "asset-1" ? ["collection-1", "collection-2"] : [],
});

function facetCounts(items, getter) {
  const map = new Map();
  for (const item of items) {
    for (const value of getter(item)) map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

const facetsFor = (items) => ({
  categories: facetCounts(items, (asset) => [asset.category]),
  extensions: facetCounts(items, (asset) => [asset.extension].filter(Boolean)),
  mediaFamilies: facetCounts(items, (asset) => [asset.mediaFamily]),
  tags: facetCounts(items, (asset) => asset.tags),
  usedIn: facetCounts(items, (asset) => asset.usedIn),
});

const preferences = {
  interfaceScale: 1,
  thumbnailDensity: 220,
  previewZoom: 1,
  viewMode: "grid",
  multiThumbnailPreviews: false,
  autoRescan: false,
};

function filterAssets(query) {
  let items = [...assets];
  const includesAll = (selected, values) => !selected.length || selected.every((value) => values.includes(value));
  if (query.search) {
    const needle = query.search.toLowerCase();
    items = items.filter((asset) => [
      asset.displayName,
      asset.relativeDisplayPath,
      asset.category,
      asset.extension,
      ...asset.tags,
      ...asset.usedIn,
    ].join(" ").toLowerCase().includes(needle));
  }
  if (query.reviewStates.length) items = items.filter((asset) => query.reviewStates.includes(asset.reviewState));
  if (query.availability.length) items = items.filter((asset) => query.availability.includes(asset.availability));
  if (query.categories.length) items = items.filter((asset) => includesAll(query.categories, [asset.category]));
  if (query.extensions.length) items = items.filter((asset) => includesAll(query.extensions, [asset.extension]));
  if (query.mediaFamilies.length) items = items.filter((asset) => includesAll(query.mediaFamilies, [asset.mediaFamily]));
  if (query.tags.length) items = items.filter((asset) => includesAll(query.tags, asset.tags));
  if (query.usedIn.length) items = items.filter((asset) => includesAll(query.usedIn, asset.usedIn));
  const sorters = {
    name_ascending: (a, b) => a.displayName.localeCompare(b.displayName),
    name_descending: (a, b) => b.displayName.localeCompare(a.displayName),
    created_ascending: (a, b) => a.createdAtMs - b.createdAtMs,
    created_descending: (a, b) => b.createdAtMs - a.createdAtMs,
    size_ascending: (a, b) => a.byteSize - b.byteSize,
    size_descending: (a, b) => b.byteSize - a.byteSize,
    review_state: (a, b) => a.reviewState.localeCompare(b.reviewState),
  };
  items.sort(sorters[query.sort] || sorters.created_ascending);
  return items;
}

function svgFor(assetId) {
  const index = Math.max(0, Number(assetId.split("-")[1] || 1) - 1);
  const first = palette[index % palette.length];
  const second = palette[(index + 4) % palette.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="820" viewBox="0 0 1200 820"><rect width="1200" height="820" fill="${first}"/><path d="M0 650L340 270L650 610L890 170L1200 550V820H0Z" fill="${second}" opacity=".78"/><circle cx="${180 + (index % 5) * 180}" cy="${150 + (index % 3) * 110}" r="${95 + (index % 4) * 28}" fill="#171717" opacity=".78"/><rect x="60" y="60" width="1080" height="700" fill="none" stroke="#171717" stroke-width="14"/><text x="80" y="745" font-family="Arial,sans-serif" font-size="46" font-weight="700" fill="#171717">${assetId.toUpperCase()}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

contextBridge.exposeInMainWorld("referenceLibrary", {
  version: 4,
  createLibrary: async (name) => ({ ...baseSession, name: name || baseSession.name }),
  openLibrary: async () => ({ ...baseSession }),
  completeOpenIntent: async () => ({ ...baseSession }),
  readPreferences: async () => ({ ...preferences }),
  writePreferences: async (patch) => ({ ...Object.assign(preferences, patch) }),
  closeLibrary: async () => {},
  chooseRoot: async () => null,
  listRoots: async () => roots.map((root) => ({ ...root })),
  reauthorizeRoot: async () => ({ session: { ...baseSession }, root: { ...roots[1], authorized: true, state: "ready" } }),
  scanRoot: async (_sessionId, rootId) => ({ rootId, jobId: "job-1" }),
  cancelJob: async () => {},
  queryJobs: async () => ({ offset: 0, limit: 100, total: 0, items: [], nextOffset: null }),
  queryAssets: async ({ offset, limit, query }) => {
    const items = filterAssets(query);
    return {
      offset,
      limit,
      total: items.length,
      items: items.slice(offset, offset + limit).map((asset) => ({ ...asset })),
      nextOffset: offset + limit < items.length ? offset + limit : null,
      libraryRevision: 1,
      facets: facetsFor(items),
    };
  },
  getAsset: async (_sessionId, assetId) => detailFor(assets.find((asset) => asset.assetId === assetId)),
  updateAsset: async (input) => {
    const asset = assets.find((candidate) => candidate.assetId === input.assetId);
    const patch = input.patch || {};
    if (patch.reviewState !== undefined) asset.reviewState = patch.reviewState;
    if (patch.customTitle?.kind === "set") asset.customTitle = patch.customTitle.value;
    if (patch.customTitle?.kind === "clear") asset.customTitle = null;
    if (patch.tags?.kind === "set") asset.tags = [...patch.tags.value];
    if (patch.usedIn?.kind === "set") asset.usedIn = [...patch.usedIn.value];
    asset.revision += 1;
    return { asset: detailFor(asset), libraryRevision: 2 };
  },
  listCollections: async () => collections.map((collection) => ({ ...collection })),
  createCollection: async (_sessionId, name) => ({ collectionId: "new", name, assetCount: 0, revision: 1 }),
  renameCollection: async (_sessionId, collectionId, _revision, name) => ({ collectionId, name, assetCount: 0, revision: 2 }),
  deleteCollection: async () => {},
  setCollectionMembership: async ({ collectionId, assetIds }) => ({ collectionId, affected: assetIds.length, libraryRevision: 2 }),
  assetResourceUrl: ({ assetId }) => svgFor(assetId),
  revealLocation: async () => {},
  openLocation: async () => {},
  copyLocationPath: async () => {},
  queryCapabilities: async () => [],
  restartCore: async () => ({ ...baseSession }),
  subscribe: () => () => {},
});
