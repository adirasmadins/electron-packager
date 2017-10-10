'use strict'

const asar = require('asar')
const debug = require('debug')('electron-packager')
const fs = require('fs-extra')
const path = require('path')
const pify = require('pify')

const ignore = require('./ignore')
const pruneModules = require('./prune').pruneModules

const common = require('./common')

class App {
  constructor (opts, templatePath) {
    this.opts = opts
    this.templatePath = templatePath
  }

  get resourcesDir () {
    return path.join(this.stagingPath, 'resources')
  }

  get resourcesAppDir () {
    return path.join(this.resourcesDir, 'app')
  }

  get electronBinaryDir () {
    return this.stagingPath
  }

  get electronBinaryPath () {
    return this.stagingPath
  }

  get originalElectronName () {
    throw new Error('Child classes must implement this')
  }

  get newElectronName () {
    throw new Error('Child classes must implement this')
  }

  get stagingPath () {
    if (this.opts.tmpdir === false) {
      return common.generateFinalPath(this.opts)
    } else {
      return path.join(
        common.baseTempDir(this.opts),
        `${this.opts.platform}-${this.opts.arch}`,
        common.generateFinalBasename(this.opts)
      )
    }
  }

  renameElectron () {
    return common.rename(this.electronBinaryDir, this.originalElectronName, this.newElectronName)
  }

  /**
   * Performs the following initial operations for an app:
   * * Creates temporary directory
   * * Copies template into temporary directory
   * * Copies user's app into temporary directory
   * * Prunes non-production node_modules (if opts.prune is either truthy or undefined)
   * * Creates an asar (if opts.asar is set)
   */
  initialize () {
    debug(`Initializing app in ${this.stagingPath} from ${this.templatePath} template`)

    return fs.move(this.templatePath, this.stagingPath, { clobber: true })
      .then(() =>
        fs.copy(this.opts.dir, this.resourcesAppDir, {
          filter: ignore.userIgnoreFilter(this.opts),
          dereference: this.opts.derefSymlinks
        })
      ).then(() => {
        const afterCopyHooks = (this.opts.afterCopy || []).map(
          afterCopyFn => pify(afterCopyFn)(this.resourcesAppDir, this.opts.electronVersion, this.opts.platform, this.opts.arch)
        )
        return Promise.all(afterCopyHooks)
      }).then(() => {
        // Support removing old default_app folder that is now an asar archive
        return fs.remove(path.join(this.resourcesDir, 'default_app'))
      }).then(() => fs.remove(path.join(this.resourcesDir, 'default_app.asar')))
      // Prune and asar are performed before platform-specific logic, primarily so that
      // this.resourcesAppDir is predictable (e.g. before .app is renamed for mac)
      .then(() => this.prune())
      .then(() => this.asarApp())
  }

  prune () {
    if (this.opts.prune || this.opts.prune === undefined) {
      return pruneModules(this.opts, this.resourcesAppDir)
        .then(() => {
          const afterPruneHooks = (this.opts.afterPrune || []).map(
            afterPruneFn => pify(afterPruneFn)(this.resourcesAppDir, this.opts.electronVersion, this.opts.platform, this.opts.arch)
          )
          return Promise.all(afterPruneHooks)
        })
    }

    return Promise.resolve()
  }

  asarApp () {
    const asarOptions = common.createAsarOpts(this.opts)
    if (!asarOptions) {
      return Promise.resolve()
    }

    const dest = path.join(this.resourcesDir, 'app.asar')
    debug(`Running asar with the options ${JSON.stringify(asarOptions)}`)
    return pify(asar.createPackageWithOptions)(this.resourcesAppDir, dest, asarOptions)
      .then(() => fs.remove(this.resourcesAppDir))
  }

  copyExtraResources (extraResources) {
    if (!extraResources) return Promise.resolve()

    if (!Array.isArray(extraResources)) extraResources = [extraResources]

    return Promise.all(extraResources.map(
      resource => fs.copy(resource, path.resolve(this.stagingPath, this.resourcesDir, path.basename(resource)))
    ))
  }

  move () {
    const finalPath = common.generateFinalPath(this.opts)

    if (this.opts.tmpdir === false) {
      return Promise.resolve(finalPath)
    }

    debug(`Moving ${this.stagingPath} to ${finalPath}`)
    return fs.move(this.stagingPath, finalPath)
      .then(() => finalPath)
  }
}

module.exports = App
