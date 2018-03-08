const _ = require('lodash')
const request = require('request')

class Bot {
  constructor (config) {
    this.settings = _.extend({
      endpoint: 'http://en.wikipedia.org:80/w/api.php',
      index: 'http://en.wikipedia.org:80/w/index.php',
      rate: 60e3 / 10,
      byeline: '(using the MediaWiki module for Node.js)'
    }, config)
  }

  get (args, requestIndex) {
    return this._request(args, 'GET', requestIndex)
  }

  post (args, requestIndex) {
    return this._request(args, 'POST', requestIndex)
  }

  _request (args, method, requestIndex) {
    return new Promise((resolve, reject) => {
      args.format = 'json' // we will always expect JSON

      const options = {
        uri: requestIndex ? this.settings.index : this.settings.endpoint,
        qs: args,
        method: method,
        form: args,
        jar: true // this enables cookies for us
      }

      request(options, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          let data = {}

          try {
            data = JSON.parse(body)
          } catch (err) {
            return reject(err)
          } finally {
            resolve(data)
          }
        } else {
          reject(new Error(response.statusCode))
        }
      })
    })
  }

  login (username, password) {
    return new Promise((resolve, reject) => {
      this.post({ action: 'login', lgname: username, lgpassword: password }).then((data) => {
        switch (data.login.result) {
          case 'Success':
            return resolve(data.login.lgusername)
          case 'NeedToken':
            this.post({ action: 'login', lgname: username, lgpassword: password, lgtoken: data.login.token }).then(function (data) {
              if (data.login.result == 'Success') {
                resolve(data.login.lgusername)
              } else {
                reject(new Error(data.login.result))
              }
            }).catch(reject)
            break
          default:
            return reject(new Error(data.login.result))
        }
      }).catch(reject)
    })
  }

  logout () {
    return this.post({ action: 'logout' })
  }

  getUserName () {
    return this.userinfo().then((userinfo) => {
      return userinfo.name
    })
  }

  getUserInfo () {
    return this.get({ action: 'query', meta: 'userinfo' }).then((data) => {
      return data.query.userinfo
    })
  }

  /**
   * Perform a semantic query and get back results as GeoJSON
   *
   * @param {string} [query] SMW Query Text to pass along.
   * @return {Promise<object>} A promise which resolves with a decoded GeoJSON object.
   */
  geojson (query) {
    return this.get({
      title: 'Special:Ask',
      q: (query || []).concat(['[[Geometry::+]]']).join('\r\n'),
      po: ['?Geometry', '?Category'].join('\r\n'),
      'p[format]': 'geojson',
      'p[limit]': '100'
    }, true)
  }

  /**
   * Get a page by its title.
   *
   * @param {string} title Page title.
   * @return {Promise<object>} A promise which resolves with the page object.
   */
  getPage (title) {
    return this._page({ titles: title })
  }

  /**
   * Get a single page revision.
   *
   * @param {string} id Revision ID.
   * @return {Promise<object>} A promise which resolves with the page object.
   */
  getPageRevision (id) {
    return this._page({ revids: id })
  }

  // does the work of Bot.prototype.page and Bot.prototype.revision
  // and ensures both functions return the same things
  _page (query) {
    return new Promise((resolve, reject) => {
      query.action = 'query'
      query.prop = 'revisions'
      query.rvprop = 'timestamp|content'

      this.get(query).then(function (data) {
        var pages = Object.getOwnPropertyNames(data.query.pages)
        var _this = this
        pages.forEach(function (id) {
          var page = data.query.pages[id]
          resolve(page)
        })
      }).catch(reject)
    })
  }

  /**
   * Get the edit history of a page by its title
   *
   * @param {string} title Page title.
   * @param {number} [count=] Revision history limit.
   */
  getPageHistory (title, count) {
    return new Promise((resolve, reject) => {
      var c = ''
      var rvc = ''
      var history = []

      const next = () => {
        const args = {
          action: 'query',
          prop: 'revisions',
          titles: title,
          rvprop: 'timestamp|user|ids|comment|size|tags',
          rvlimit: count,
          continue: c
        }

        if (c != '') args.rvcontinue = rvc

        this.get(args).then((data) => {
          var pages = Object.getOwnPropertyNames(data.query.pages)
          var page = data.query.pages[pages[0]]
          page.revisions.forEach(function (revision) {
            revision.timestamp = new Date(revision.timestamp)
            if (history.length < count) history.push(revision)
          })
          if (data.continue && history.length < count) {
            c = data.continue.continue
            rvc = data.continue.rvcontinue
            next()
          } else {
            resolve(page.title, history)
          }
        }).catch(reject)
      }

      next()
    })
  }

  category (category) {
    return new Promise((resolve, reject) => {
      var c = ''
      var cmc = ''
      var pages = []
      var subcategories = [];
      const next = () => {
        var args = {
          action: 'query',
          list: 'categorymembers',
          cmtitle: category,
          cmlimit: 'max',
          cmsort: 'sortkey',
          cmdir: 'desc',
          continue: c
        }
        if (c != '') args.cmcontinue = cmc

        this.get(args).then((data) => {
          var members = data.query.categorymembers
          members.forEach(function (member) {
            if (member.ns == 14) {
              subcategories.push(member.title)
            } else {
              pages.push(member.title)
            }
          })

          if (data.continue) {
            c = data.continue.continue
            cmc = data.continue.cmcontinue
            next(true)
          } else {
            resolve(category, pages, subcategories)
          }
        }).catch(reject)
      }

      next()
    })
  }

  edit (title, text, summary) {
    summary += ' ' + this.settings.byeline
    return this._edit(title, null, text, summary)
  }

  add (title, heading, body) {
    return this._edit(title, 'new', body, heading)
  }

  // does the work of Bot.prototype.edit and Bot.prototype.add
  // section should be null to replace the entire page or "new" to add a new section
  _edit (title, section, text, summary) {
    return new Promise((resolve, reject) => {
      this.get({ action: 'query', prop: 'info|revisions', intoken: 'edit', titles: title }).then((data) => {
            // data.tokens.edittoken
        var props = Object.getOwnPropertyNames(data.query.pages)
        var _this = this
        props.forEach((prop) => {
          var token = data.query.pages[prop].edittoken
          var starttimestamp = data.query.pages[prop].starttimestamp
          var basetimestamp = data.query.pages[prop].revisions[0].timestamp
          var args = { action: 'edit', title: title, text: text, summary: summary, token: token, bot: true, basetimestamp: basetimestamp, starttimestamp: starttimestamp }
          if (section != null) args.section = section
          _this.post(args).then((data) => {
            if (data.edit.result === 'Success') {
              resolve(data.edit.title, data.edit.newrevid, new Date(data.edit.newtimestamp))
            } else {
              reject(new Error(data.edit.result))
            }
          }).catch(reject)
        })
      }).catch(reject)
    })
  }
}

module.exports = { Bot: Bot }
