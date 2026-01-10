const Chunks = require('prismarine-chunk')
const mcData = require('minecraft-data')

function columnKey (x, z) {
  return `${x},${z}`
}

function posInChunk (pos) {
  pos = pos.floored()
  pos.x &= 15
  pos.z &= 15
  return pos
}

function isCube (shapes) {
  if (!shapes || shapes.length !== 1) return false
  const shape = shapes[0]
  return shape[0] === 0 && shape[1] === 0 && shape[2] === 0 && shape[3] === 1 && shape[4] === 1 && shape[5] === 1
}

class World {
  constructor (version) {
    this.Chunk = Chunks(version)
    this.columns = {}
    this.blockCache = {}
    const data = mcData(version)
    this.biomeCache = data.biomes
    this.maxStateId = Math.max(...Object.keys(data.blocksByStateId).map(Number))
    this.blocksByStateId = data.blocksByStateId
    this.loggedMissingBlock = false
    this.loggedInvalidState = false
    this.invalidStateLogLimit = 20
    this.loggedInvalidStateIds = new Set()
  }

  addColumn (x, z, json) {
    const chunk = this.Chunk.fromJson(json)
    this.columns[columnKey(x, z)] = chunk
    return chunk
  }

  removeColumn (x, z) {
    delete this.columns[columnKey(x, z)]
  }

  getColumn (x, z) {
    return this.columns[columnKey(x, z)]
  }

  setBlockStateId (pos, stateId) {
    if (stateId > this.maxStateId) {
      if (!this.loggedInvalidState) {
        this.loggedInvalidState = true
        console.log('[prismarine-viewer] ignoring invalid stateId', stateId)
      }
      return false
    }
    const key = columnKey(Math.floor(pos.x / 16) * 16, Math.floor(pos.z / 16) * 16)

    const column = this.columns[key]
    // null column means chunk not loaded
    if (!column) return false

    column.setBlockStateId(posInChunk(pos.floored()), stateId)

    return true
  }

  getBlock (pos) {
    const key = columnKey(Math.floor(pos.x / 16) * 16, Math.floor(pos.z / 16) * 16)

    const column = this.columns[key]
    // null column means chunk not loaded
    if (!column) return null

    const loc = pos.floored()
    const locInChunk = posInChunk(loc)
    let stateId = column.getBlockStateId(locInChunk)
    const hasMapping = this.blocksByStateId && this.blocksByStateId[stateId]
    if (stateId > this.maxStateId || !hasMapping) {
      if (this.loggedInvalidStateIds.size < this.invalidStateLogLimit && !this.loggedInvalidStateIds.has(stateId)) {
        this.loggedInvalidStateIds.add(stateId)
        const sectionIndex = Math.floor((loc.y - column.minY) / 16)
        const section = column.sections?.[sectionIndex]
        const container = section?.data
        let containerType = 'unknown'
        if (container) {
          if (typeof container.value === 'number' && !container.palette) {
            containerType = 'single'
          } else if (Array.isArray(container.palette)) {
            containerType = 'indirect'
          } else {
            containerType = 'direct'
          }
        }
        const containerBits = container?.data?.bitsPerValue
        const containerLen = container?.data?.data?.length
        console.log('[prismarine-viewer] invalid stateId in chunk', {
          stateId,
          maxStateId: this.maxStateId,
          hasMapping: Boolean(hasMapping),
          pos: { x: loc.x, y: loc.y, z: loc.z },
          chunk: key,
          sectionIndex,
          minY: column.minY,
          containerType,
          containerBits,
          paletteLength: container?.palette?.length,
          singleValue: container?.value,
          dataLength: containerLen
        })
      }
      stateId = 0
    }

    if (!this.blockCache[stateId]) {
      const b = column.getBlock(locInChunk)
      b.isCube = isCube(b.shapes)
      this.blockCache[stateId] = b
    }

    const block = this.blockCache[stateId]
    if (!block.name && !this.loggedMissingBlock) {
      this.loggedMissingBlock = true
      console.log('[prismarine-viewer] empty block name for stateId', stateId)
    }
    block.position = loc
    if (typeof column.getBiomeData === 'function') {
      block.biome = column.getBiomeData(locInChunk)
    } else {
      block.biome = this.biomeCache[column.getBiome(locInChunk)]
    }
    if (block.biome === undefined) {
      block.biome = this.biomeCache[1]
    }
    block.biomeColor = block.biome?.color
    return block
  }
}

module.exports = { World }
