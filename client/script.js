// ----------------------------------------------------------------
// конфиг — адрес сервера
// для локалки: http://localhost:3000
// для продакшена подставь свой
// ----------------------------------------------------------------
const SERVER_URL = '';

// ----------------------------------------------------------------
// DOM-элементы
// ----------------------------------------------------------------
const keywordInput = document.getElementById('keywordInput');
const searchBtn = document.getElementById('searchBtn');
const searchError = document.getElementById('searchError');

const urlsBlock = document.getElementById('urlsBlock');
const currentKeywordSpan = document.getElementById('currentKeywordSpan');
const urlsList = document.getElementById('urlsList');

const progressBlock = document.getElementById('progressBlock');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const progressSizeInfo = document.getElementById('progressSizeInfo');
const progressError = document.getElementById('progressError');

const savedList = document.getElementById('savedList');

const viewerBlock = document.getElementById('viewerBlock');
const viewerTitle = document.getElementById('viewerTitle');
const viewerContent = document.getElementById('viewerContent');
const closeViewerBtn = document.getElementById('closeViewerBtn');

// ----------------------------------------------------------------
// обработчики событий
// ----------------------------------------------------------------
searchBtn.addEventListener('click', searchUrls);
keywordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchUrls();
});
closeViewerBtn.addEventListener('click', () => {
  viewerBlock.classList.add('hidden');
});

// загружаем сохранённое при старте
document.addEventListener('DOMContentLoaded', renderSavedItems);

// ----------------------------------------------------------------
// поиск урлов по ключевому слову
// ----------------------------------------------------------------
async function searchUrls() {
  const keyword = keywordInput.value.trim();
  hideError(searchError);
  urlsBlock.classList.add('hidden');
  urlsList.innerHTML = '';

  if (!keyword) {
    showError(searchError, 'Введи ключевое слово');
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = 'Ищу...';

  try {
    const res = await fetch(`${SERVER_URL}/api/urls?keyword=${encodeURIComponent(keyword)}`);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Ошибка сервера (статус ${res.status})`);
    }

    const data = await res.json();

    if (!data.urls || data.urls.length === 0) {
      throw new Error('По этому слову ничего не найдено');
    }

    currentKeywordSpan.textContent = keyword;
    renderUrls(data.urls);
    urlsBlock.classList.remove('hidden');

  } catch (err) {
    showError(searchError, err.message);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Найти';
  }
}

// ----------------------------------------------------------------
// рисуем список урлов
// ----------------------------------------------------------------
function renderUrls(urls) {
  urlsList.innerHTML = urls.map(url => `
    <div class="url-row">
      <span>${escapeHTML(url)}</span>
      <button class="fetch-btn" data-url="${escapeHTML(url)}">Скачать</button>
    </div>
  `).join('');

  // вешаем обработчики на кнопки
  urlsList.querySelectorAll('.fetch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      fetchAndSave(url);
    });
  });
}

// ----------------------------------------------------------------
// основная функция — качаем контент через сервер
// ----------------------------------------------------------------
async function fetchAndSave(url) {
  // показываем блок прогресса
  progressBlock.classList.remove('hidden');
  hideError(progressError);
  progressBar.style.width = '0%';
  progressPercent.textContent = '0%';
  progressSizeInfo.textContent = '0 KB / 0 KB';

  try {
    const res = await fetch(`${SERVER_URL}/api/fetch?url=${encodeURIComponent(url)}`);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Ошибка загрузки (статус ${res.status})`);
    }

    // читаем поток
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // строки разделены \n, каждая строка — json
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // последняя может быть неполной

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const msg = JSON.parse(line);
          handleStreamMessage(msg);

          if (msg.type === 'complete') {
            finalContent = msg.content;
          }
        } catch {
          // бывает мусор в строке — игнорируем
        }
      }
    }

    // сохраняем в localStorage
    if (finalContent) {
      saveToLocalStorage(url, finalContent);
    }

    // прячем прогресс через пару секунд
    setTimeout(() => {
      progressBlock.classList.add('hidden');
    }, 1500);

  } catch (err) {
    showError(progressError, err.message);
    // прячем прогресс через 4 сек если ошибка
    setTimeout(() => {
      progressBlock.classList.add('hidden');
    }, 4000);
  }
}

// ----------------------------------------------------------------
// обрабатываем сообщения из потока
// ----------------------------------------------------------------
function handleStreamMessage(msg) {
  switch (msg.type) {
    case 'meta':
      // просто инфа о начале загрузки
      break;

    case 'progress':
      progressBar.style.width = `${msg.progress}%`;
      progressPercent.textContent = `${msg.progress}%`;
      progressSizeInfo.textContent = `${formatBytes(msg.downloaded)} / ${formatBytes(msg.totalSize)}`;
      break;

    case 'complete':
      progressBar.style.width = '100%';
      progressPercent.textContent = '100% ✓';
      progressSizeInfo.textContent = `Готово! ${formatBytes(msg.totalSize)}`;
      break;

    case 'error':
      showError(progressError, msg.error);
      break;
  }
}

// ----------------------------------------------------------------
// работа с localStorage
// ----------------------------------------------------------------
function saveToLocalStorage(url, content) {
  const items = JSON.parse(localStorage.getItem('saved_content') || '[]');

  // обрезаем если слишком большой (localStorage не резиновый)
  const maxContentSize = 300000;
  const trimmedContent = content.length > maxContentSize
    ? content.substring(0, maxContentSize) + '\n\n... [текст обрезан для экономии места]'
    : content;

  items.unshift({
    id: Date.now(),
    url,
    content: trimmedContent,
    size: content.length,
    savedAt: new Date().toISOString()
  });

  // храним не больше 15 записей
  if (items.length > 15) items.length = 15;

  localStorage.setItem('saved_content', JSON.stringify(items));
  renderSavedItems();
}

function renderSavedItems() {
  const items = JSON.parse(localStorage.getItem('saved_content') || '[]');

  if (items.length === 0) {
    savedList.innerHTML = '<p class="empty-hint">Пока ничего не скачано</p>';
    return;
  }

  savedList.innerHTML = items.map(item => `
    <div class="saved-item" data-id="${item.id}">
      <div class="info">
        <div class="url-text">${escapeHTML(item.url)}</div>
        <div class="meta">
          ${formatBytes(item.size)} &middot; ${new Date(item.savedAt).toLocaleString('ru-RU')}
        </div>
      </div>
      <button class="delete-btn" data-id="${item.id}">🗑</button>
    </div>
  `).join('');

  // обработчики кликов
  savedList.querySelectorAll('.saved-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // если кликнули по кнопке удаления — не открываем
      if (e.target.classList.contains('delete-btn')) return;

      const id = Number(el.getAttribute('data-id'));
      openViewer(id);
    });
  });

  savedList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(btn.getAttribute('data-id'));
      deleteSavedItem(id);
    });
  });
}

function openViewer(id) {
  const items = JSON.parse(localStorage.getItem('saved_content') || '[]');
  const item = items.find(i => i.id === id);

  if (!item) {
    alert('Запись не найдена (возможно была удалена)');
    return;
  }

  viewerTitle.textContent = item.url;
  viewerContent.textContent = item.content;
  viewerBlock.classList.remove('hidden');
  viewerBlock.scrollIntoView({ behavior: 'smooth' });
}

function deleteSavedItem(id) {
  let items = JSON.parse(localStorage.getItem('saved_content') || '[]');
  items = items.filter(i => i.id !== id);
  localStorage.setItem('saved_content', JSON.stringify(items));
  renderSavedItems();

  // закрываем просмотрщик если удалили то что открыто
  viewerBlock.classList.add('hidden');
}

// ----------------------------------------------------------------
// утилиты
// ----------------------------------------------------------------
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 KB';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}