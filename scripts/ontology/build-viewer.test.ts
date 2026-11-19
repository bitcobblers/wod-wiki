import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  READABLE_HASH_MAX_LEN,
  type OntologyBundle,
  buildViewer,
  compileOntologyBundle,
  computeCascadeDelete,
  computeHopDepths,
  createInitialState,
  decodeWalkHash,
  encodeWalkHash,
  findFuzzyReplacements,
  getUnwalkedCanvasHints,
  indexBundle,
  reduceWalkerState,
  renderExplorerHtml,
  resolveLegacyHash,
} from './build-viewer';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');

function createSyntheticCustomFixture(tmpDir: string): {
  metaPath: string;
  registryPath: string;
  shapesDir: string;
} {
  const ontDir = path.join(tmpDir, 'ontology');
  const sysDir = path.join(ontDir, 'system');
  const recDir = path.join(ontDir, 'recipes');
  const ingDir = path.join(ontDir, 'ingredients');
  const shapesDir = path.join(ontDir, 'shapes');
  fs.mkdirSync(sysDir, { recursive: true });
  fs.mkdirSync(recDir, { recursive: true });
  fs.mkdirSync(ingDir, { recursive: true });
  fs.mkdirSync(shapesDir, { recursive: true });

  // Copy real sys: meta vocabulary so we test the real meta-ontology
  const realMeta = fs.readFileSync(path.join(REPO_ROOT, 'ontology/system/meta.ttl'), 'utf8');
  const metaPath = path.join(sysDir, 'meta.ttl');
  fs.writeFileSync(metaPath, realMeta, 'utf8');

  const registryPath = path.join(sysDir, 'registry.ttl');
  fs.writeFileSync(
    registryPath,
    `
@prefix sys:  <https://wod.wiki/ontology/system#> .
@prefix exg:  <https://example.org/graph/> .
@prefix rec:  <https://example.org/recipes#> .
@prefix ing:  <https://example.org/ingredients#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

<https://example.org/kitchen-dataset> a sys:OntologySystem ;
    rdfs:label "Synthetic Kitchen Ontology System" ;
    owl:versionInfo "1.0.0" ;
    sys:managedNamespace <https://example.org/> ;
    sys:hasOntologyGraph
        exg:meta_recipes ,
        exg:meta_ingredients ;
    sys:hasGraphBridge
        exg:bridge_recipe_uses_ingredient ;
    sys:hasLinkContract
        exg:lc_historical_source .

exg:meta_recipes a sys:OntologyGraph ;
    sys:graphIri exg:recipes ;
    sys:slug "recipes" ;
    sys:ontologyKind sys:LocalOntology ;
    sys:layerOrder 1 ;
    sys:accentToken "custom-paprika" ;
    rdfs:label "Recipes" ;
    rdfs:comment "Custom Local Sub-Ontology for culinary recipes." ;
    sys:schemaGlob "ontology/recipes/*.ttl" ;
    sys:hasNodeKind exg:nk_recipe .

exg:nk_recipe a sys:NodeKind ;
    sys:kindSlug "recipe" ;
    sys:badgeLabel "Recipe" ;
    sys:selectorMode sys:InstanceSelector ;
    sys:targetClass rec:Recipe ;
    sys:idProperty rec:recipeId ;
    sys:labelProperty rdfs:label .

exg:meta_ingredients a sys:OntologyGraph ;
    sys:graphIri exg:ingredients ;
    sys:slug "ingredients" ;
    sys:ontologyKind sys:LocalOntology ;
    sys:layerOrder 2 ;
    sys:accentToken "emerald" ;
    rdfs:label "Ingredients" ;
    rdfs:comment "Custom Local Sub-Ontology for pantry ingredients." ;
    sys:schemaGlob "ontology/ingredients/*.ttl" ;
    sys:hasNodeKind exg:nk_ingredient .

exg:nk_ingredient a sys:NodeKind ;
    sys:kindSlug "ingredient" ;
    sys:badgeLabel "Ingredient" ;
    sys:selectorMode sys:InstanceSelector ;
    sys:targetClass ing:Ingredient ;
    sys:idProperty ing:code ;
    sys:labelProperty rdfs:label .

exg:bridge_recipe_uses_ingredient a sys:GraphBridge ;
    sys:bridgePredicate rec:usesIngredient ;
    sys:sourceGraph exg:recipes ;
    sys:targetGraph exg:ingredients ;
    sys:sourceClass rec:Recipe ;
    sys:targetClass ing:Ingredient ;
    sys:forwardLabel "uses ingredient" ;
    sys:inverseLabel "used in recipe" ;
    sys:navPriority 10 .

exg:lc_historical_source a sys:LinkContract ;
    sys:linkPredicate rec:inspiredBy ;
    sys:targetGraph exg:ingredients ;
    sys:targetClass ing:Ingredient ;
    sys:forwardLabel "inspired by" ;
    sys:inverseLabel "inspired" ;
    sys:navPriority 20 ;
    sys:allowHistoricalMissingTarget true .
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(recDir, 'recipes.ttl'),
    `
@prefix rec:  <https://example.org/recipes#> .
@prefix ing:  <https://example.org/ingredients#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

rec:Recipe a owl:Class ; rdfs:label "Recipe" .
rec:PrepStep a owl:Class ; rdfs:label "Prep Step" .
rec:hasPrepStep a owl:ObjectProperty ; rdfs:label "Preparation Steps" .

rec:sourdough a rec:Recipe ;
    rec:recipeId "sourdough" ;
    rdfs:label "Country Sourdough" ;
    rdfs:comment "Naturally leavened hearth loaf." ;
    rec:usesIngredient ing:flour , ing:water , ing:salt ;
    rec:inspiredBy <https://example.org/ingredients/deleted-heirloom-wheat> ;
    rec:hasPrepStep rec:step_1 , rec:step_2 .

rec:step_1 a rec:PrepStep ;
    rdfs:label "Autolyse flour and water" ;
    rec:stepOrder 1 ;
    rec:usesIngredient ing:flour .

rec:step_2 a rec:PrepStep ;
    rdfs:label "Incorporate salt and fold" ;
    rec:stepOrder 2 ;
    rec:usesIngredient ing:salt .

rec:focaccia a rec:Recipe ;
    rec:recipeId "focaccia" ;
    rdfs:label "Olive Oil Focaccia" ;
    rdfs:comment "Dimpled sheet-pan flatbread." ;
    rec:usesIngredient ing:flour , ing:salt .
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(ingDir, 'ingredients.ttl'),
    `
@prefix ing:  <https://example.org/ingredients#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

ing:Ingredient a owl:Class ; rdfs:label "Ingredient" .

ing:flour a ing:Ingredient ;
    ing:code "flour" ;
    rdfs:label "Bread Flour" ;
    rdfs:comment "High-protein stone-ground wheat flour." ;
    ing:pairsWith ing:water .

ing:water a ing:Ingredient ;
    ing:code "water" ;
    rdfs:label "Filtered Water" ;
    rdfs:comment "Room-temperature hydration." ;
    ing:pairsWith ing:salt .

ing:salt a ing:Ingredient ;
    ing:code "salt" ;
    rdfs:label "Fine Sea Salt" ;
    rdfs:comment "Unrefined sea salt." .
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(shapesDir, 'recipes-shapes.ttl'),
    `
@prefix rec: <https://example.org/recipes#> .
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

rec:RecipeShape a sh:NodeShape ;
    sh:targetClass rec:Recipe ;
    sh:property [
        sh:path rec:recipeId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:message "Every recipe must have one recipeId." ;
    ] .
`,
    'utf8',
  );

  return { metaPath, registryPath, shapesDir };
}

describe('build-viewer compiler & byte-determinism', () => {
  let tmpDir: string;
  let realBundle: OntologyBundle;
  let realHtml: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wod-viewer-test-'));
    realBundle = compileOntologyBundle({ repoRoot: REPO_ROOT });
    realHtml = renderExplorerHtml(realBundle);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces byte-identical bundle JSON and explorer HTML across back-to-back runs', () => {
    const bundle2 = compileOntologyBundle({ repoRoot: REPO_ROOT });
    const html2 = renderExplorerHtml(bundle2);

    expect(JSON.stringify(bundle2)).toBe(JSON.stringify(realBundle));
    expect(html2).toBe(realHtml);
    expect(realHtml).toContain('window.__ONTOLOGY_BUNDLE__ =');
    expect(realHtml).not.toContain('cdn.jsdelivr.net');
    expect(realHtml).not.toContain('unpkg.com');
  });

  it('compiles real WOD Wiki dataset with walkable code:Symbols, drawerSections, metaEdges, and historical ghosts', () => {
    expect(realBundle.slices.length).toBeGreaterThanOrEqual(4);
    expect(realBundle.health.totalRealNodes).toBeGreaterThan(1000);

    // Walkable code:Symbol nodes exist
    const symbolKindIdx = realBundle.nodeKinds.findIndex((nk) => nk.kindSlug === 'symbol');
    expect(symbolKindIdx).toBeGreaterThanOrEqual(0);
    const symbolCount = realBundle.nodes.filter((n) => n.kindIdx === symbolKindIdx && !n.ghost).length;
    expect(symbolCount).toBeGreaterThan(100);

    // Nested drawerSections for SHACL constraints on a domain class (e.g. wod:Note)
    const noteNode = realBundle.nodes.find((n) => n.id === 'wod:Note');
    expect(noteNode).toBeDefined();
    expect(noteNode!.drawerSections.some((s) => s.kind === 'constraints')).toBe(true);

    // Nested drawerSections for 5-beat qa:Step chain on a QA suite
    const nodeWithChain = realBundle.nodes.find((n) =>
      n.drawerSections.some((s) => s.kind === 'chain' && s.items.length >= 3),
    );
    expect(nodeWithChain).toBeDefined();

    // metaEdges include declared local bridges + auto-derived global/generated summaries
    expect(realBundle.metaEdges.some((m) => m.kind === 'localBridge')).toBe(true);
    expect(realBundle.metaEdges.some((m) => m.kind === 'global')).toBe(true);
    expect(realBundle.metaEdges.some((m) => m.kind === 'generatedLink')).toBe(true);

    // Historical missing targets materialized as ghost nodes and tracked in health
    expect(realBundle.health.historicalMissingTargets.length).toBeGreaterThan(0);
    expect(realBundle.health.totalGhostNodes).toBeGreaterThan(0);
    const ghostNode = realBundle.nodes.find((n) => n.ghost && n.ghostReason === 'historical-missing-target');
    expect(ghostNode).toBeDefined();
  });

  it('compiles a synthetic custom Local Sub-Ontology fixture with zero hardcoded WOD Wiki slice/kind logic', () => {
    const fixtureDir = path.join(tmpDir, 'synthetic');
    const { metaPath, registryPath, shapesDir } = createSyntheticCustomFixture(fixtureDir);

    const bundle = compileOntologyBundle({
      repoRoot: fixtureDir,
      metaPath,
      registryPath,
      shapesDir,
    });

    expect(bundle.system.label).toBe('Synthetic Kitchen Ontology System');
    expect(bundle.slices.map((s) => s.slug)).toEqual(['recipes', 'ingredients']);
    expect(bundle.slices[0].accentToken).toBe('custom-paprika');
    expect(bundle.nodeKinds.map((nk) => nk.kindSlug)).toEqual(['recipe', 'ingredient']);

    const sourdough = bundle.nodes.find((n) => n.id === 'recipe:sourdough');
    expect(sourdough).toBeDefined();
    expect(sourdough!.label).toBe('Country Sourdough');

    // Nested non-walkable PrepSteps compiled into an ordered chain drawer section with clickable jumpNodeIds
    const prepSection = sourdough!.drawerSections.find((s) => s.kind === 'chain');
    expect(prepSection).toBeDefined();
    expect(prepSection!.items.map((i) => i.label)).toEqual([
      'Autolyse flour and water',
      'Incorporate salt and fold',
    ]);
    expect(prepSection!.items[0].jumpNodeIds).toEqual(['ingredient:flour']);

    // Historical missing target from custom LinkContract materialized as ghost node
    expect(bundle.health.historicalMissingTargets.length).toBe(1);
    expect(bundle.nodes.some((n) => n.ghost && n.iri.includes('deleted-heirloom-wheat'))).toBe(true);

    // Declared Local <-> Local bridge appears in metaEdges with live assertion count
    const bridgeMeta = bundle.metaEdges.find((m) => m.predicateCurie === 'rec:usesIngredient');
    expect(bridgeMeta).toBeDefined();
    expect(bridgeMeta!.assertionCount).toBe(5);

    // HTML builds cleanly to disk
    const outPath = path.join(fixtureDir, 'explorer.html');
    const built = buildViewer({
      repoRoot: fixtureDir,
      metaPath,
      registryPath,
      shapesDir,
      outPath,
      silent: true,
    });
    expect(fs.existsSync(outPath)).toBe(true);
    expect(built.html).toContain('Synthetic Kitchen Ontology System');
  });
});

describe('WalkerEngine reducer, diamond-safe cascade Delete, 3-tier hash codec & ghost nodes', () => {
  let tmpDir: string;
  let bundle: OntologyBundle;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wod-walker-engine-'));
    const { metaPath, registryPath, shapesDir } = createSyntheticCustomFixture(tmpDir);
    bundle = compileOntologyBundle({ repoRoot: tmpDir, metaPath, registryPath, shapesDir });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('performs diamond-safe cascade Delete, preserves shared targets, supports Undo, and resets to meta on root Delete', () => {
    const index = indexBundle(bundle);
    let state = createInitialState(index);
    expect(state.mode).toBe('meta');

    // Start walk at recipe:sourdough
    state = reduceWalkerState(state, { type: 'START_WALK_AT_NODE', nodeId: 'recipe:sourdough' }, index);
    expect(state.mode).toBe('walk');
    expect(state.rootNodeId).toBe('recipe:sourdough');

    // Build diamond:
    //   sourdough -> flour -> water -> salt
    //   sourdough -> salt   (alternate path directly to salt!)
    //   focaccia branch: flour -> focaccia (exclusive tail off flour)
    state = reduceWalkerState(
      state,
      { type: 'WALK_STEP', fromId: 'recipe:sourdough', toId: 'ingredient:flour', predicate: 'rec:usesIngredient' },
      index,
    );
    state = reduceWalkerState(
      state,
      { type: 'WALK_STEP', fromId: 'ingredient:flour', toId: 'ingredient:water', predicate: 'ing:pairsWith' },
      index,
    );
    state = reduceWalkerState(
      state,
      { type: 'WALK_STEP', fromId: 'ingredient:water', toId: 'ingredient:salt', predicate: 'ing:pairsWith' },
      index,
    );
    // Refocus & link existing node ingredient:salt directly from root (should NOT duplicate salt!)
    state = reduceWalkerState(
      state,
      { type: 'WALK_STEP', fromId: 'recipe:sourdough', toId: 'ingredient:salt', predicate: 'rec:usesIngredient' },
      index,
    );
    expect(state.walkedNodes.filter((id) => id === 'ingredient:salt').length).toBe(1);
    expect(state.lastPruneReport?.kind).toBe('refocus');

    // Verify hop depths (sourdough=0, flour=1, salt=1, water=2)
    const depths = computeHopDepths(state);
    expect(depths.get('recipe:sourdough')).toBe(0);
    expect(depths.get('ingredient:flour')).toBe(1);
    expect(depths.get('ingredient:salt')).toBe(1);
    expect(depths.get('ingredient:water')).toBe(2);

    // Cascade-delete ingredient:flour:
    // - ingredient:water is exclusive downstream -> MUST BE PRUNED
    // - ingredient:salt is a shared diamond target reachable via sourdough -> salt -> MUST BE RETAINED!
    const preview = computeCascadeDelete(state, 'ingredient:flour');
    expect(preview.resetToMeta).toBe(false);
    expect(preview.prunedNodeIds).toEqual(['ingredient:water']);
    expect(preview.retainedDiamondNodeIds).toEqual(['ingredient:salt']);

    state = reduceWalkerState(state, { type: 'CASCADE_DELETE_FOCUSED', targetId: 'ingredient:flour' }, index);
    expect(state.walkedNodes).toEqual(['recipe:sourdough', 'ingredient:salt']);
    expect(state.walkedNodes).not.toContain('ingredient:water');

    // Undo restores all 4 nodes
    state = reduceWalkerState(state, { type: 'UNDO_DELETE' }, index);
    expect(state.walkedNodes).toHaveLength(4);
    expect(state.walkedNodes).toContain('ingredient:water');

    // Unwalked hints detects sourdough -> water (which is in the dataset but not in walkedEdges)
    const hints = getUnwalkedCanvasHints(index, state);
    expect(hints.some((h) => h.sourceId === 'recipe:sourdough' && h.targetId === 'ingredient:water')).toBe(true);

    // Deleting root node resets cleanly to mode: 'meta'
    state = reduceWalkerState(state, { type: 'CASCADE_DELETE_FOCUSED', targetId: 'recipe:sourdough' }, index);
    expect(state.mode).toBe('meta');
    expect(state.rootNodeId).toBeNull();
    expect(state.walkedNodes).toEqual([]);
    expect(state.focusedNodeId).toBe('slice:recipes');
  });

  it('round-trips #meta, readable #root=, compressed #g=v1., legacy #/<kind>/<id>, and stale ghost nodes', () => {
    const index = indexBundle(bundle);

    // 1. Meta tier
    const metaState = createInitialState(index, { focusedNodeId: 'slice:ingredients', drawerOpen: true });
    const metaEncoded = encodeWalkHash(metaState);
    expect(metaEncoded.tier).toBe('meta');
    expect(metaEncoded.hash).toBe('#meta&focus=slice:ingredients&drawer=1');
    const metaDecoded = decodeWalkHash(metaEncoded.hash, index);
    expect(metaDecoded.state.mode).toBe('meta');
    expect(metaDecoded.state.focusedNodeId).toBe('slice:ingredients');
    expect(metaDecoded.state.drawerOpen).toBe(true);

    // 2. Readable #root= tier (<= 320 chars)
    let walk = createInitialState(index);
    walk = reduceWalkerState(walk, { type: 'START_WALK_AT_NODE', nodeId: 'recipe:sourdough', openDrawer: true }, index);
    walk = reduceWalkerState(
      walk,
      { type: 'WALK_STEP', fromId: 'recipe:sourdough', toId: 'ingredient:flour', predicate: 'rec:usesIngredient' },
      index,
    );
    const readableEncoded = encodeWalkHash(walk);
    expect(readableEncoded.tier).toBe('readable');
    expect(readableEncoded.hash.startsWith('#root=recipe:sourdough&edges=')).toBe(true);
    expect(readableEncoded.hash.length).toBeLessThanOrEqual(READABLE_HASH_MAX_LEN);

    const readableDecoded = decodeWalkHash(readableEncoded.hash, index);
    expect(readableDecoded.state.mode).toBe('walk');
    expect(readableDecoded.state.rootNodeId).toBe('recipe:sourdough');
    expect(readableDecoded.state.walkedNodes).toEqual(['recipe:sourdough', 'ingredient:flour']);
    expect(readableDecoded.state.focusedNodeId).toBe('ingredient:flour');
    expect(readableDecoded.state.drawerOpen).toBe(true);

    // 3. Compressed #g=v1. tier (> 320 chars)
    const longWalk = {
      ...walk,
      walkedEdges: Array.from({ length: 12 }, (_, idx) => ({
        id: `e-${idx}`,
        from: 'recipe:sourdough',
        to: 'ingredient:flour',
        predicate: `rec:veryLongCustomBridgePredicateNumber${idx}`,
        verb: 'uses',
        direction: 'outgoing' as const,
        edgeCategory: 'localBridge' as const,
        sliceCross: true,
      })),
    };
    const compEncoded = encodeWalkHash(longWalk);
    expect(compEncoded.tier).toBe('compressed');
    expect(compEncoded.hash.startsWith('#g=v1.')).toBe(true);
    const compDecoded = decodeWalkHash(compEncoded.hash, index);
    expect(compDecoded.state.mode).toBe('walk');
    expect(compDecoded.state.rootNodeId).toBe('recipe:sourdough');
    expect(compDecoded.state.walkedEdges).toHaveLength(12);

    // 4. Legacy #/<kind>/<id> redirect
    expect(resolveLegacyHash('#/recipe/sourdough', index)).toBe('recipe:sourdough');
    const legacyDecoded = decodeWalkHash('#/recipe/sourdough', index);
    expect(legacyDecoded.legacyRedirect).toBe(true);
    expect(legacyDecoded.state.rootNodeId).toBe('recipe:sourdough');
    expect(legacyDecoded.state.drawerOpen).toBe(true);

    // 5. Stale deep link -> Unresolved Ghost Node + fuzzy replacement + REPLACE_GHOST_NODE
    const staleDecoded = decodeWalkHash(
      '#root=recipe:sourdough&edges=recipe:sourdough~rec:usesIngredient~ingredient:bread-flour-old&focus=ingredient:bread-flour-old',
      index,
    );
    expect(staleDecoded.ghostIds).toEqual(['ingredient:bread-flour-old']);
    expect(staleDecoded.state.runtimeGhosts['ingredient:bread-flour-old']?.ghost).toBe(true);
    expect(staleDecoded.state.runtimeGhosts['ingredient:bread-flour-old']?.ghostReason).toBe('stale-deep-link');

    const suggestions = findFuzzyReplacements(index, 'ingredient:bread-flour-old');
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].node.id).toBe('ingredient:flour');

    const replaced = reduceWalkerState(
      staleDecoded.state,
      { type: 'REPLACE_GHOST_NODE', ghostId: 'ingredient:bread-flour-old', replacementId: 'ingredient:flour' },
      index,
    );
    expect(replaced.walkedNodes).toEqual(['recipe:sourdough', 'ingredient:flour']);
    expect(replaced.focusedNodeId).toBe('ingredient:flour');
    expect(replaced.runtimeGhosts['ingredient:bread-flour-old']).toBeUndefined();
  });
});

describe('Headless Playwright file:// smoke test', () => {
  let tmpDir: string;
  let htmlPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wod-viewer-pw-'));
    const { metaPath, registryPath, shapesDir } = createSyntheticCustomFixture(tmpDir);
    htmlPath = path.join(tmpDir, 'explorer.html');
    buildViewer({
      repoRoot: tmpDir,
      metaPath,
      registryPath,
      shapesDir,
      outPath: htmlPath,
      silent: true,
    });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('drives Space, Ctrl+/, Enter, Delete, hash round-trip, legacy redirect, and ghost nodes over file:// with 0 console errors', async () => {
    let playwright: typeof import('playwright');
    try {
      playwright = await import('playwright');
    } catch {
      console.warn('Playwright not installed; skipping browser smoke test.');
      return;
    }

    let browser: Awaited<ReturnType<typeof playwright.chromium.launch>>;
    try {
      browser = await playwright.chromium.launch();
    } catch {
      console.warn('Playwright Chromium binary unavailable; skipping browser smoke test.');
      return;
    }

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => pageErrors.push(err.message));

      const fileUrl = `file://${htmlPath}`;
      await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });

      // 1. Meta Constellation loads with both custom slices
      await page.waitForSelector('[data-meta-id="slice:recipes"]');
      await page.waitForSelector('[data-meta-id="slice:ingredients"]');

      // 2. Press Space on focused slice:recipes -> opens slice-scoped fuzzy picker -> select sourdough
      await page.keyboard.press('Space');
      await page.waitForSelector('#palette-dialog[open]');
      await page.fill('#palette-search-input', 'sourdough');
      await page.keyboard.press('Enter');

      // Now in walk mode rooted at recipe:sourdough
      await page.waitForSelector('[data-node-id="recipe:sourdough"]');
      const hashAfterRoot = await page.evaluate(() => window.location.hash);
      expect(hashAfterRoot).toContain('root=recipe:sourdough');

      // 3. Press Space in walk mode -> walk connected neighbor ingredient:flour
      await page.keyboard.press('Space');
      await page.waitForSelector('#palette-dialog[open]');
      await page.fill('#palette-search-input', 'flour');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-node-id="ingredient:flour"]');

      // 4. Press Enter -> opens slide-out Detail Drawer
      await page.keyboard.press('Enter');
      const drawerHiddenAfterEnter = await page.locator('#detail-drawer').getAttribute('hidden');
      expect(drawerHiddenAfterEnter).toBeNull();
      expect(await page.locator('#detail-drawer').textContent()).toContain('Bread Flour');

      // 5. Press Ctrl+/ -> opens Global Fuzzy Finder -> jump to recipe:sourdough
      await page.keyboard.press('Control+/');
      await page.waitForSelector('#palette-dialog[open]');
      await page.fill('#palette-search-input', 'sourdough');
      await page.keyboard.press('Enter');

      // 6. Press Delete on focused root node -> resets to Meta Constellation
      await page.keyboard.press('Delete');
      await page.waitForSelector('[data-meta-id="slice:recipes"]');

      // 7. Legacy #/recipe/sourdough redirect via replaceState
      await page.goto(`${fileUrl}#/recipe/sourdough`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-node-id="recipe:sourdough"]');
      await page.waitForFunction(() => window.location.hash.startsWith('#root=recipe:sourdough'));
      const redirectedHash = await page.evaluate(() => window.location.hash);
      expect(redirectedHash).toContain('drawer=1');

      // 8. Stale deep link -> renders Unresolved Ghost Node with "Did you mean?" suggestions
      await page.goto(
        `${fileUrl}#root=recipe:sourdough&edges=recipe:sourdough~rec:usesIngredient~ingredient:missing-flour&focus=ingredient:missing-flour&drawer=1`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector('[data-node-id="ingredient:missing-flour"].is-ghost');
      const drawerText = await page.locator('#detail-drawer').textContent();
      expect(drawerText).toContain('Unresolved Ghost Node');
      expect(drawerText).toContain('Did you mean?');
      expect(drawerText).toContain('Bread Flour');

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);
});
