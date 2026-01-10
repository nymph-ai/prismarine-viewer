/* global postMessage self */

if (!global.self) {
  // If we are in a node environement, we need to fake some env variables
  /* eslint-disable no-eval */
  const r = eval('require') // yeah I know bad spooky eval, booouh
  const { parentPort } = r('worker_threads')
  global.self = parentPort
  global.postMessage = (value, transferList) => { parentPort.postMessage(value, transferList) }
  global.performance = r('perf_hooks').performance
}

const { Vec3 } = require('vec3')
const { World } = require('./world')
const { getSectionGeometry } = require('./models')
const fs = require('fs')
const path = require('path')

let blocksStates = null
let world = null
let currentVersion = null
let loggedFirstGeometry = false
let loggedPositiveDirty = false
let loggedPositiveGeometry = false

function attachAtlasDebug (version, target) {
  if (!process.env.PRISMARINE_VIEWER_DEBUG_TEX_COUNTS) return
  if (!version || !target || target.__atlasIndex) return
  try {
    const atlasPath = path.resolve(__dirname, `../../public/blocksStates/${version}.atlas.json`)
    const atlas = JSON.parse(fs.readFileSync(atlasPath, 'utf8'))
    if (!atlas || !atlas.size || !atlas.textures) return
    const index = new Map()
    for (const [name, tex] of Object.entries(atlas.textures)) {
      const x = Math.round(tex.u / atlas.size)
      const y = Math.round(tex.v / atlas.size)
      index.set(`${x},${y}`, name)
    }
    target.__atlasIndex = index
    target.__atlasTileSize = atlas.size
    console.log('[prismarine-viewer] debug atlas loaded', index.size)
  } catch (err) {
    console.log('[prismarine-viewer] debug atlas load failed', err.message)
  }
}

function sectionKey (x, y, z) {
  return `${x},${y},${z}`
}

const dirtySections = {}

function setSectionDirty (pos, value = true) {
  const x = Math.floor(pos.x / 16) * 16
  const y = Math.floor(pos.y / 16) * 16
  const z = Math.floor(pos.z / 16) * 16
  const chunk = world.getColumn(x, z)
  const minY = chunk?.minY ?? 0
  const sectionIndex = chunk ? Math.floor((y - minY) / 16) : -1
  if (!loggedPositiveDirty && y >= 0) {
    loggedPositiveDirty = true
    console.log('[prismarine-viewer] dirty section', { x, y, z, minY, sectionIndex, hasSection: Boolean(chunk?.sections?.[sectionIndex]) })
  }
  const key = sectionKey(x, y, z)
  if (!value) {
    delete dirtySections[key]
    postMessage({ type: 'sectionFinished', key })
  } else if (chunk && sectionIndex >= 0 && sectionIndex < chunk.sections.length && chunk.sections[sectionIndex]) {
    dirtySections[key] = value
  } else {
    postMessage({ type: 'sectionFinished', key })
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'version') {
    world = new World(data.version)
    currentVersion = data.version
  } else if (data.type === 'blockStates') {
    blocksStates = data.json
    attachAtlasDebug(currentVersion, blocksStates)
    if (!blocksStates.__logLoaded) {
      blocksStates.__logLoaded = true
      console.log('[prismarine-viewer] blockStates loaded')
    }
  } else if (data.type === 'dirty') {
    const loc = new Vec3(data.x, data.y, data.z)
    setSectionDirty(loc, data.value)
  } else if (data.type === 'chunk') {
    world.addColumn(data.x, data.z, data.chunk)
    if (!world.__loggedColumn) {
      world.__loggedColumn = true
      const column = world.getColumn(data.x, data.z)
      console.log('[prismarine-viewer] column info', {
        x: data.x,
        z: data.z,
        minY: column?.minY,
        worldHeight: column?.worldHeight,
        sections: column?.sections?.length
      })
    }
  } else if (data.type === 'unloadChunk') {
    world.removeColumn(data.x, data.z)
  } else if (data.type === 'blockUpdate') {
    const loc = new Vec3(data.pos.x, data.pos.y, data.pos.z).floored()
    world.setBlockStateId(loc, data.stateId)
  } else if (data.type === 'reset') {
    world = null
    blocksStates = null
  }
}

setInterval(() => {
  if (world === null || blocksStates === null) return
  const sections = Object.keys(dirtySections)

  if (sections.length === 0) return
  // console.log(sections.length + ' dirty sections')

  // const start = performance.now()
  for (const key of sections) {
    let [x, y, z] = key.split(',')
    x = parseInt(x, 10)
    y = parseInt(y, 10)
    z = parseInt(z, 10)
    const chunk = world.getColumn(x, z)
    const minY = chunk?.minY ?? 0
    const sectionIndex = chunk ? Math.floor((y - minY) / 16) : -1
    if (chunk && sectionIndex >= 0 && sectionIndex < chunk.sections.length && chunk.sections[sectionIndex]) {
      delete dirtySections[key]
      const geometry = getSectionGeometry(x, y, z, world, blocksStates)
      if (!loggedFirstGeometry) {
        loggedFirstGeometry = true
        console.log('[prismarine-viewer] geometry key', key, 'verts', geometry.positions.length / 3)
      }
      if (!loggedPositiveGeometry && y >= 0 && geometry.positions.length > 0) {
        loggedPositiveGeometry = true
        console.log('[prismarine-viewer] geometry positive', key, 'verts', geometry.positions.length / 3)
      } else if (y >= 0 && geometry.positions.length === 0 && !loggedPositiveGeometry) {
        console.log('[prismarine-viewer] geometry positive empty', key)
      }
      const transferable = [geometry.positions.buffer, geometry.normals.buffer, geometry.colors.buffer, geometry.uvs.buffer]
      postMessage({ type: 'geometry', key, geometry }, transferable)
    }
    postMessage({ type: 'sectionFinished', key })
  }
  // const time = performance.now() - start
  // console.log(`Processed ${sections.length} sections in ${time} ms (${time / sections.length} ms/section)`)
}, 50)
