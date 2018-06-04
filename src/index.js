// XXX The default HTTP parser of Node.js (in C++) is quite strict and does not
// accept responses with 2 CONTENT_LENGTH headers (even with the same value).
// The SOS Villages d'Enfants website does this on some response. A work-around is
// to use http-parser-js, but to work it must be loaded before any
// `require('http')`. So, we put it in the first line here. But it's not enough for
// `yarn standalone` that loads some libs before loading this file. If you have a
// `HPE_UNEXPECTED_CONTENT_LENGTH` error when running it in development, you can
// copy the line below to `node_modules/.bin/cozy-run-standalone`.
process.binding('http_parser').HTTPParser = require('http-parser-js').HTTPParser

const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  // debug: false,
  cheerio: true,
  json: false,
  jar: true
})

const baseUrl = 'https://www.sosve.org/espace-donateur'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/dons-et-recus-fiscaux/`)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields.folderPath, {
    identifiers: ['SOSVE', 'SOS VILLAGES ENFANTS']
  })
}

function authenticate(username, password) {
  return signin({
    url: `${baseUrl}/`,
    formSelector: '#loginform',
    formData: {
      log: username,
      pwd: password
    },
    validate: (statusCode, $) => {
      if ($(`a[href='${baseUrl}/mon-profil/mot-de-passe/']`).length === 1) {
        return true
      } else {
        log('error', $('.error').text())
        return false
      }
    },
    requestOpts: {}
  })
}

function parseDocuments($) {
  const docs = scrape(
    $,
    {
      title: {
        sel: 'h3 a',
        attr: 'title'
      },
      amount: {
        sel: '.price_color',
        parse: normalizePrice
      },
      url: {
        sel: 'h3 a',
        attr: 'href',
        parse: url => `${baseUrl}/${url}`
      },
      fileurl: {
        sel: 'img',
        attr: 'src',
        parse: src => `${baseUrl}/${src}`
      },
      filename: {
        sel: 'h3 a',
        attr: 'title',
        parse: title => `${title}.jpg`
      }
    },
    'article'
  )
  return docs.map(doc => ({
    ...doc,
    date: new Date(),
    currency: '€',
    vendor: 'SOSVE',
    metadata: {
      importDate: new Date(),
      version: 1
    }
  }))
}

// convert a price string to a float
function normalizePrice(price) {
  return parseFloat(price.replace('£', '').trim())
}
