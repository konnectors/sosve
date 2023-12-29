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
  saveBills,
  log,
  errors
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
  log('info', 'checking maintenance')
  const resp = await request(baseUrl, {
    resolveWithFullResponse: true
  })
  if (resp.request.uri.href.includes('maintenance')) {
    throw new Error(errors.VENDOR_DOWN)
  }

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
    debug: true,
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
  log('info', 'parseDocuments')
  let docs = []
  const years = $('.main-content .sosve-accordion-inner-data')
  for (let i = 0; i < years.length; i++) {
    const year = $(years[i]).find('.donate-history-table.small')
    const fileurl = $($(years[i]).find('a.download-recap-link')).attr('href')
    const rows = $(year).find('tr')
    rows.each((j, row) => {
      const cells = $(row).find('td')
      if (cells.length < 3) {
        return
      }
      const date = $(cells[0]).text()
      let doc = {
        title: 'Don du ' + date,
        amount: normalizePrice($(cells[cells.length - 1]).text()),
        date: normalizeDate(date)
      }
      if (fileurl) {
        const parts = fileurl.split('/')
        const y = parts[parts.length - 3]
        const n = parts[parts.length - 2]
        const filename = `${y}-${n}.pdf`
        doc = { fileurl, filename, ...doc }
      }
      docs.push(doc)
    })
  }
  return docs.map(doc => ({
    ...doc,
    currency: '€',
    vendor: 'SOSVE',
    metadata: {
      importDate: new Date(),
      version: 1
    }
  }))
}

function normalizePrice(price) {
  return parseFloat(price.replace('€', '').trim())
}

function normalizeDate(date) {
  const parts = date.split('/')
  return new Date(parts[2], parts[1], parts[0], 12)
}
