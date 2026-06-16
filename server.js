const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ----------------------------------------------------------------
// раздаём статику из папки client
// ----------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'client')));

// ----------------------------------------------------------------
// база ключевых слов (можешь дополнять)
// ----------------------------------------------------------------
const keywordsDB = {
  'javascript': [
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction',
    'https://javascript.info/intro',
    'https://nodejs.org/en/about'
  ],
  'python': [
    'https://www.python.org/about/gettingstarted/',
    'https://docs.python.org/3/tutorial/appetite.html'
  ],
  'html': [
    'https://developer.mozilla.org/en-US/docs/Web/HTML',
    'https://www.w3schools.com/html/html_intro.asp'
  ],
  'css': [
    'https://developer.mozilla.org/en-US/docs/Web/CSS',
    'https://www.w3schools.com/css/css_intro.asp'
  ],
  'react': [
    'https://react.dev/learn',
    'https://legacy.reactjs.org/docs/getting-started.html'
  ]
};

// ----------------------------------------------------------------
// GET /api/urls?keyword=...
// ----------------------------------------------------------------
app.get('/api/urls', (req, res) => {
  const keyword = (req.query.keyword || '').toLowerCase().trim();

  if (!keyword) {
    return res.status(400).json({ error: 'Не передано ключевое слово' });
  }

  const urls = keywordsDB[keyword];

  if (!urls || urls.length === 0) {
    return res.status(404).json({
      error: `По слову "${keyword}" ничего не найдено. Доступные слова: ${Object.keys(keywordsDB).join(', ')}`
    });
  }

  res.json({ keyword, urls });
});

// ----------------------------------------------------------------
// GET /api/fetch?url=...
// ----------------------------------------------------------------
app.get('/api/fetch', (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Не передан URL' });
  }

  // проверяем что url валидный
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Некорректный URL' });
  }

  const fetcher = parsedUrl.protocol === 'https:' ? https : http;

  const request = fetcher.get(targetUrl, { timeout: 15000 }, (targetRes) => {

    // обработка редиректов
    if (targetRes.statusCode >= 300 && targetRes.statusCode < 400 && targetRes.headers.location) {
      return res.redirect(`/api/fetch?url=${encodeURIComponent(targetRes.headers.location)}`);
    }

    if (targetRes.statusCode !== 200) {
      return res.status(502).json({
        error: `Целевой сервер ответил статусом ${targetRes.statusCode}`
      });
    }

    const totalSize = parseInt(targetRes.headers['content-length']) || 0;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    // первое сообщение — метаданные
    res.write(JSON.stringify({
      type: 'meta',
      totalSize,
      url: targetUrl
    }) + '\n');

    let downloaded = 0;
    const chunks = [];

    targetRes.on('data', (chunk) => {
      downloaded += chunk.length;
      chunks.push(chunk);

      // отправляем прогресс не на каждый чип, а примерно каждые 100кб
      if (downloaded % (100 * 1024) < chunk.length || downloaded >= totalSize) {
        const progress = totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0;

        res.write(JSON.stringify({
          type: 'progress',
          downloaded,
          totalSize,
          progress
        }) + '\n');
      }
    });

    targetRes.on('end', () => {
      const fullContent = Buffer.concat(chunks).toString('utf-8');

      // обрезаем слишком большие ответы
      const maxLength = 500 * 1024;
      const contentToSend = fullContent.length > maxLength
        ? fullContent.substring(0, maxLength) + '\n\n... [текст обрезан]'
        : fullContent;

      res.write(JSON.stringify({
        type: 'complete',
        content: contentToSend,
        totalSize: downloaded,
        progress: 100
      }) + '\n');

      res.end();
    });

    targetRes.on('error', (err) => {
      res.write(JSON.stringify({
        type: 'error',
        error: `Ошибка при скачивании: ${err.message}`
      }) + '\n');
      res.end();
    });
  });

  request.on('error', (err) => {
    if (!res.headersSent) {
      return res.status(500).json({
        error: `Не удалось подключиться к серверу: ${err.message}`
      });
    }

    res.write(JSON.stringify({
      type: 'error',
      error: err.message
    }) + '\n');
    res.end();
  });

  request.on('timeout', () => {
    request.destroy();
    if (!res.headersSent) {
      return res.status(504).json({ error: 'Превышено время ожидания (15 секунд)' });
    }
  });
});


// ----------------------------------------------------------------
// старт
// ----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log('Ключевые слова:', Object.keys(keywordsDB).join(', '));
});
