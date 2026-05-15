const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
//  URL del RSS de Expreso Ecuador
// ─────────────────────────────────────────
const RSS_URL = 'https://www.expreso.ec/rss/';

// ─── Utilidades ───────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'AlexaSkill/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const m = r.exec(block);
      return m ? (m[1] || m[2] || '').trim() : '';
    };

    items.push({
      titulo: get('title') || 'Sin título',
      resumen: limpiarHtml(get('description') || 'Sin descripción'),
      categoria: get('category') || 'General',
      fecha: formatearFecha(get('pubDate')),
    });
  }
  return items;
}

function limpiarHtml(texto) {
  return texto
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, 'y')
    .replace(/&lt;/g, '')
    .replace(/&gt;/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function formatearFecha(pubDate) {
  if (!pubDate) return '';
  try {
    return new Date(pubDate).toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  } catch (e) { return ''; }
}

async function fetchNoticias(categoria = null) {
  const xml = await httpGet(RSS_URL);
  let noticias = parseRSS(xml);
  if (categoria && categoria.toLowerCase() !== 'todas') {
    noticias = noticias.filter(n =>
      n.categoria.toLowerCase().includes(categoria.toLowerCase())
    );
  }
  return noticias;
}

function buildTitulares(noticias, inicio, cantidad = 5) {
  const lote = noticias.slice(inicio, inicio + cantidad);
  if (!lote.length) return 'No hay más noticias disponibles.';
  return lote.map((n, i) => `Noticia ${inicio + i + 1}: ${n.titulo}.`).join(' ');
}

// ─── Handlers ─────────────────────────────

const LaunchRequestHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest';
  },
  async handle(h) {
    try {
      const noticias = await fetchNoticias();
      const session = h.attributesManager.getSessionAttributes();
      session.noticias = noticias;
      session.indice = 0;
      h.attributesManager.setSessionAttributes(session);

      const ultima = noticias[0];
      const fecha = ultima.fecha ? `del ${ultima.fecha}` : '';
      const speak =
        `Bienvenido a Expreso. ` +
        `La noticia más reciente ${fecha} es: ${ultima.titulo}. ` +
        `${ultima.resumen} ` +
        `Hay ${noticias.length} noticias en total. ` +
        `Puedes decir: leer titulares, leer noticia número dos, o noticias de deportes. ¿Qué deseas?`;

      return h.responseBuilder.speak(speak)
        .reprompt('Di: leer titulares, o elige una categoría como deportes o política.')
        .getResponse();
    } catch (e) {
      console.error(e);
      return h.responseBuilder.speak('No pude cargar las noticias de Expreso. Intenta de nuevo.').getResponse();
    }
  }
};

const LeerTitularesIntentHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(h.requestEnvelope) === 'LeerTitularesIntent';
  },
  async handle(h) {
    try {
      const session = h.attributesManager.getSessionAttributes();
      let noticias = session.noticias;
      if (!noticias) { noticias = await fetchNoticias(); session.noticias = noticias; }

      const titulares = buildTitulares(noticias, 0, 5);
      session.indice = 5;
      h.attributesManager.setSessionAttributes(session);

      return h.responseBuilder
        .speak(`Titulares principales: ${titulares} ¿Deseas más titulares o leer una noticia completa?`)
        .reprompt('Di: más titulares, o leer noticia número tres.')
        .getResponse();
    } catch (e) {
      return h.responseBuilder.speak('No pude obtener los titulares.').getResponse();
    }
  }
};

const MasTitularesIntentHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(h.requestEnvelope) === 'MasTitularesIntent';
  },
  handle(h) {
    const session = h.attributesManager.getSessionAttributes();
    const noticias = session.noticias || [];
    const indice = session.indice || 0;

    if (indice >= noticias.length) {
      return h.responseBuilder
        .speak('Ya leímos todos los titulares. ¿Deseas escuchar alguna noticia completa?')
        .reprompt('Di el número de la noticia que quieres escuchar.')
        .getResponse();
    }

    const titulares = buildTitulares(noticias, indice, 5);
    session.indice = indice + 5;
    h.attributesManager.setSessionAttributes(session);

    return h.responseBuilder
      .speak(`${titulares} ¿Deseas más titulares o leer alguna noticia completa?`)
      .reprompt('Di: más titulares, o leer noticia número tres.')
      .getResponse();
  }
};

const LeerNoticiaIntentHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(h.requestEnvelope) === 'LeerNoticiaIntent';
  },
  async handle(h) {
    try {
      const session = h.attributesManager.getSessionAttributes();
      let noticias = session.noticias;
      if (!noticias) { noticias = await fetchNoticias(); session.noticias = noticias; }

      const slots = h.requestEnvelope.request.intent.slots;
      const numero = parseInt(slots.numeroNoticia?.value, 10);

      if (isNaN(numero) || numero < 1 || numero > noticias.length) {
        return h.responseBuilder
          .speak(`Por favor di un número entre 1 y ${noticias.length}.`)
          .reprompt('¿Qué número de noticia quieres escuchar?')
          .getResponse();
      }

      const n = noticias[numero - 1];
      const speak =
        `Noticia ${numero}: ${n.titulo}. ` +
        `${n.fecha ? 'Publicada el ' + n.fecha + '. ' : ''}` +
        `Categoría: ${n.categoria}. ` +
        `${n.resumen} ` +
        `¿Deseas escuchar otra noticia?`;

      h.attributesManager.setSessionAttributes(session);
      return h.responseBuilder.speak(speak)
        .reprompt('Di el número de otra noticia o di: más titulares.')
        .getResponse();
    } catch (e) {
      return h.responseBuilder.speak('No pude obtener esa noticia.').getResponse();
    }
  }
};

const FiltrarCategoriaIntentHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(h.requestEnvelope) === 'FiltrarCategoriaIntent';
  },
  async handle(h) {
    try {
      const slots = h.requestEnvelope.request.intent.slots;
      const categoria = slots.categoria?.value;

      if (!categoria) {
        return h.responseBuilder
          .speak('¿Qué categoría deseas? Por ejemplo: deportes, política o economía.')
          .reprompt('Di el nombre de una categoría.')
          .getResponse();
      }

      const noticias = await fetchNoticias(categoria);
      const session = h.attributesManager.getSessionAttributes();
      session.noticias = noticias;
      session.indice = 5;
      h.attributesManager.setSessionAttributes(session);

      if (!noticias.length) {
        return h.responseBuilder
          .speak(`No encontré noticias en la categoría ${categoria}. ¿Deseas otra categoría?`)
          .reprompt('Di el nombre de otra categoría.')
          .getResponse();
      }

      const titulares = buildTitulares(noticias, 0, 5);
      return h.responseBuilder
        .speak(`Categoría ${categoria}, ${noticias.length} noticias: ${titulares} ¿Quieres leer alguna completa?`)
        .reprompt('Di el número de la noticia.')
        .getResponse();
    } catch (e) {
      return h.responseBuilder.speak('No pude filtrar las noticias.').getResponse();
    }
  }
};

const HelpIntentHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent';
  },
  handle(h) {
    return h.responseBuilder
      .speak('Puedes decir: leer titulares, leer noticia número tres, noticias de deportes, o más titulares. ¿Qué deseas?')
      .reprompt('¿Cómo puedo ayudarte?')
      .getResponse();
  }
};

const CancelAndStopIntentHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
      && (Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.CancelIntent'
        || Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.StopIntent');
  },
  handle(h) {
    return h.responseBuilder.speak('¡Hasta pronto! Vuelve cuando quieras leer Expreso.').getResponse();
  }
};

const RepeatIntentHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.RepeatIntent';
  },
  handle(h) {
    return h.responseBuilder
      .speak('Para repetir una noticia, di el número nuevamente. Por ejemplo: leer noticia número uno.')
      .reprompt('¿Qué número de noticia deseas?')
      .getResponse();
  }
};

const SessionEndedRequestHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'SessionEndedRequest'; },
  handle(h) { return h.responseBuilder.getResponse(); }
};

const ErrorHandler = {
  canHandle() { return true; },
  handle(h, error) {
    console.error('Error:', error);
    return h.responseBuilder.speak('Ocurrió un error. Por favor intenta de nuevo.').getResponse();
  }
};

const skill = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    LeerTitularesIntentHandler,
    MasTitularesIntentHandler,
    LeerNoticiaIntentHandler,
    FiltrarCategoriaIntentHandler,
    RepeatIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .create();


const adapter = new ExpressAdapter(skill, false, false);
app.post('/', adapter.getRequestHandlers());
app.get('/', (req, res) => res.send('Alexa Expreso Skill funcionando!'));
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
