/**
 * Read generated API documentation at:
 * https://aptima-prod.marcims.org/api.php
 */

const _ = require('lodash')
const MediaWiki = require('./mediawiki')

const username = 'bhutchins2'
const password = 'MARCIMSmarcims-12345'

const bot = new MediaWiki.Bot({
  endpoint: 'https://aptima-prod.marcims.org/api.php',
  index: 'https://aptima-prod.marcims.org/index.php'
})

bot.login(username, password)
  .then((data) => {
    console.log('logged in!', data)

    // now that we are logged in, start a new geojson request, you can pass it a query
    return bot.georss(['[[Has operation::MARCIMS Training]][[Category:Bridge Assessment]]'])
  })
  .then((georss) => {
    console.log('georss', georss)
    return bot.geojson(['[[Has operation::MARCIMS Training]][[Category:Bridge Assessment]]'])
  })
  .then((geojson) => {
    console.log('geojson data', geojson)
    return _.first(geojson.features)
  })
  .then((feature) => {
    console.log('geojson feature', feature)
    const title = feature.properties['Page name']
    return bot.getPage(title)
  })
  .then((page) => {
    const pageTitle = page.title
    const pageContent = page.revisions[0]['*']
    const pageLastEdited = new Date(page.revisions[0].timestamp)

    /**
     * pageContent might look like:
     *
     * {{Airfield/Airstrip Assessment4
     * |submit_as=Final
     * |start=2015-07-14T13:10:56-04
     * |username=User:Kathryn.kash
     * |geometry=POINT(-77.1437639 38.7411792)
     * |pmesii=Social
     * |date_of_assessment=2015-07-14
     * |operation=MARCIMS Training
     * }}
     */

    console.log('page', pageTitle, pageContent)
  })
  .catch((err) => {
    console.error(err)
  })
