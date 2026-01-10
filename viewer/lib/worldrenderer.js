/* global Worker */
const THREE = require('three')
const Vec3 = require('vec3').Vec3
const { loadTexture, loadJSON } = globalThis.isElectron ? require('./utils.electron.js') : require('./utils')
const { EventEmitter } = require('events')
const { dispose3 } = require('./dispose')

function mod (x, n) {
  return ((x % n) + n) % n
}

class WorldRenderer {
  constructor (scene, numWorkers = 4) {
    this.sectionMeshs = {}
    this.active = false
    this.version = undefined
    this.scene = scene
    this.loadedChunks = {}
    this.chunkInfo = {}
    this.sectionsOutstanding = new Set()
    this.renderUpdateEmitter = new EventEmitter()
    this.blockStatesData = undefined
    this.texturesDataUrl = undefined
    this.loggedFirstMesh = false
    this.loggedPositiveMesh = false
    this.loggedGeometryStats = false

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: 0xffffff,
      transparent: false,
      alphaTest: 0.1
    })

    this.workers = []
    for (let i = 0; i < numWorkers; i++) {
      // Node environement needs an absolute path, but browser needs the url of the file
      let src = __dirname
      if (typeof window !== 'undefined') src = 'worker.js'
      else src += '/worker.js'

      const worker = new Worker(src)
      worker.onmessage = ({ data }) => {
        if (data.type === 'geometry') {
          let mesh = this.sectionMeshs[data.key]
          if (data.geometry && data.geometry.debugTopTextures) {
            console.log('[prismarine-viewer] top textures', data.geometry.debugTopTextures.join(', '))
            delete data.geometry.debugTopTextures
          }
          if (mesh) {
            this.scene.remove(mesh)
            dispose3(mesh)
            delete this.sectionMeshs[data.key]
          }

          const chunkCoords = data.key.split(',')
          if (!this.loadedChunks[chunkCoords[0] + ',' + chunkCoords[2]]) return

          const geometry = new THREE.BufferGeometry()
          geometry.setAttribute('position', new THREE.BufferAttribute(data.geometry.positions, 3))
          geometry.setAttribute('normal', new THREE.BufferAttribute(data.geometry.normals, 3))
          geometry.setAttribute('color', new THREE.BufferAttribute(data.geometry.colors, 3))
          geometry.setAttribute('uv', new THREE.BufferAttribute(data.geometry.uvs, 2))
          geometry.setIndex(data.geometry.indices)

          mesh = new THREE.Mesh(geometry, this.material)
          mesh.position.set(data.geometry.sx, data.geometry.sy, data.geometry.sz)
          if (!this.loggedFirstMesh && data.geometry.positions.length > 0) {
            this.loggedFirstMesh = true
            geometry.computeBoundingBox()
            const bb = geometry.boundingBox
            console.log('[prismarine-viewer] mesh pos', data.key, mesh.position, 'bbox', bb && { min: bb.min, max: bb.max })
            console.log('[prismarine-viewer] mesh material', {
              type: mesh.material?.constructor?.name,
              mapType: mesh.material?.map?.constructor?.name,
              mapSize: mesh.material?.map?.image ? { width: mesh.material.map.image.width, height: mesh.material.map.image.height } : null
            })
            const uvAttr = geometry.getAttribute('uv')
            const map = mesh.material?.map
            const img = map?.image
            if (uvAttr && img?.data && img?.width && img?.height) {
              const u = uvAttr.array[0]
              const v = uvAttr.array[1]
              const x = Math.max(0, Math.min(img.width - 1, Math.floor(u * img.width)))
              const y = Math.max(0, Math.min(img.height - 1, Math.floor(v * img.height)))
              const yFlip = Math.max(0, Math.min(img.height - 1, Math.floor((1 - v) * img.height)))
              const idx = (y * img.width + x) * 4
              const idxFlip = (yFlip * img.width + x) * 4
              const dataArr = img.data
              const px = Array.from(dataArr.slice(idx, idx + 4))
              const pxFlip = Array.from(dataArr.slice(idxFlip, idxFlip + 4))
              console.log('[prismarine-viewer] uv sample', { u, v, x, y, yFlip, px, pxFlip })
            }
          }
          if (!this.loggedGeometryStats && data.geometry.positions.length > 0) {
            this.loggedGeometryStats = true
            const colors = data.geometry.colors
            const uvs = data.geometry.uvs
            let minC = 1; let maxC = 0
            for (let i = 0; i < colors.length; i++) {
              const v = colors[i]
              if (v < minC) minC = v
              if (v > maxC) maxC = v
            }
            let minUv = 1; let maxUv = 0
            for (let i = 0; i < uvs.length; i++) {
              const v = uvs[i]
              if (v < minUv) minUv = v
              if (v > maxUv) maxUv = v
            }
            console.log('[prismarine-viewer] geom stats', data.key, { minC, maxC, minUv, maxUv })
          }
          if (!this.loggedPositiveMesh && data.geometry.positions.length > 0 && data.geometry.sy >= 0) {
            this.loggedPositiveMesh = true
            geometry.computeBoundingBox()
            const bb = geometry.boundingBox
            console.log('[prismarine-viewer] mesh pos positive', data.key, mesh.position, 'bbox', bb && { min: bb.min, max: bb.max })
          }
          this.sectionMeshs[data.key] = mesh
          this.scene.add(mesh)
        } else if (data.type === 'sectionFinished') {
          this.sectionsOutstanding.delete(data.key)
          this.renderUpdateEmitter.emit('update')
        }
      }
      if (worker.on) worker.on('message', (data) => { worker.onmessage({ data }) })
      this.workers.push(worker)
    }
  }

  resetWorld () {
    this.active = false
    for (const mesh of Object.values(this.sectionMeshs)) {
      this.scene.remove(mesh)
    }
    this.sectionMeshs = {}
    for (const worker of this.workers) {
      worker.postMessage({ type: 'reset' })
    }
  }

  setVersion (version) {
    this.version = version
    this.resetWorld()
    this.active = true
    for (const worker of this.workers) {
      worker.postMessage({ type: 'version', version })
    }

    this.updateTexturesData()
  }

  updateTexturesData () {
    const texturePath = this.texturesDataUrl || `textures/${this.version}.png`
    loadTexture(texturePath, texture => {
      if (!texture) return
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.generateMipmaps = false
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      texture.flipY = process.env.PRISMARINE_VIEWER_FLIP_Y === 'true'
      texture.needsUpdate = true
      this.material.map = texture
      this.material.color.set(0xffffff)
      this.material.vertexColors = true
      this.material.needsUpdate = true
      if (!this.loggedTextureInfo) {
        this.loggedTextureInfo = true
        const img = texture.image
        console.log('[prismarine-viewer] texture loaded', texturePath, {
          type: texture.constructor?.name,
          width: img?.width,
          height: img?.height,
          hasData: Boolean(img),
          dataLength: img?.data?.length
        })
      }
    })

    const loadBlockStates = () => {
      return new Promise(resolve => {
        if (this.blockStatesData) return resolve(this.blockStatesData)
        return loadJSON(`blocksStates/${this.version}.json`, resolve)
      })
    }
    loadBlockStates().then((blockStates) => {
      for (const worker of this.workers) {
        worker.postMessage({ type: 'blockStates', json: blockStates })
      }
    })
  }

  addColumn (x, z, chunk) {
    this.loadedChunks[`${x},${z}`] = true
    for (const worker of this.workers) {
      worker.postMessage({ type: 'chunk', x, z, chunk })
    }
    let minY = 0
    let worldHeight = 256
    try {
      const parsed = JSON.parse(chunk)
      if (Number.isFinite(parsed.minY)) minY = parsed.minY
      if (Number.isFinite(parsed.worldHeight)) worldHeight = parsed.worldHeight
    } catch {
      // fall back to vanilla defaults
    }
    this.chunkInfo[`${x},${z}`] = { minY, worldHeight }
    for (let y = minY; y < minY + worldHeight; y += 16) {
      const loc = new Vec3(x, y, z)
      this.setSectionDirty(loc)
      this.setSectionDirty(loc.offset(-16, 0, 0))
      this.setSectionDirty(loc.offset(16, 0, 0))
      this.setSectionDirty(loc.offset(0, 0, -16))
      this.setSectionDirty(loc.offset(0, 0, 16))
    }
  }

  removeColumn (x, z) {
    delete this.loadedChunks[`${x},${z}`]
    const infoKey = `${x},${z}`
    const info = this.chunkInfo[infoKey]
    delete this.chunkInfo[infoKey]
    for (const worker of this.workers) {
      worker.postMessage({ type: 'unloadChunk', x, z })
    }
    let minY = info?.minY ?? 0
    let worldHeight = info?.worldHeight ?? 256
    for (let y = minY; y < minY + worldHeight; y += 16) {
      this.setSectionDirty(new Vec3(x, y, z), false)
      const key = `${x},${y},${z}`
      const mesh = this.sectionMeshs[key]
      if (mesh) {
        this.scene.remove(mesh)
        dispose3(mesh)
      }
      delete this.sectionMeshs[key]
    }
  }

  setBlockStateId (pos, stateId) {
    for (const worker of this.workers) {
      worker.postMessage({ type: 'blockUpdate', pos, stateId })
    }
    this.setSectionDirty(pos)
    if ((pos.x & 15) === 0) this.setSectionDirty(pos.offset(-16, 0, 0))
    if ((pos.x & 15) === 15) this.setSectionDirty(pos.offset(16, 0, 0))
    if ((pos.y & 15) === 0) this.setSectionDirty(pos.offset(0, -16, 0))
    if ((pos.y & 15) === 15) this.setSectionDirty(pos.offset(0, 16, 0))
    if ((pos.z & 15) === 0) this.setSectionDirty(pos.offset(0, 0, -16))
    if ((pos.z & 15) === 15) this.setSectionDirty(pos.offset(0, 0, 16))
  }

  setSectionDirty (pos, value = true) {
    // Dispatch sections to workers based on position
    // This guarantees uniformity accross workers and that a given section
    // is always dispatched to the same worker
    const hash = mod(Math.floor(pos.x / 16) + Math.floor(pos.y / 16) + Math.floor(pos.z / 16), this.workers.length)
    this.workers[hash].postMessage({ type: 'dirty', x: pos.x, y: pos.y, z: pos.z, value })
    this.sectionsOutstanding.add(`${Math.floor(pos.x / 16) * 16},${Math.floor(pos.y / 16) * 16},${Math.floor(pos.z / 16) * 16}`)
  }

  // Listen for chunk rendering updates emitted if a worker finished a render and resolve if the number
  // of sections not rendered are 0
  waitForChunksToRender () {
    return new Promise((resolve, reject) => {
      if (Array.from(this.sectionsOutstanding).length === 0) {
        resolve()
        return
      }

      const updateHandler = () => {
        if (this.sectionsOutstanding.size === 0) {
          this.renderUpdateEmitter.removeListener('update', updateHandler)
          resolve()
        }
      }
      this.renderUpdateEmitter.on('update', updateHandler)
    })
  }
}

module.exports = { WorldRenderer }
