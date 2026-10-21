// ==== Poids par défaut des types de questions (ajustables aussi dans l'UI, écran de sélection) ====
const WEIGHTS = {
	fr_to_en_type: 3,     // FR -> EN, réponse tapée
	en_to_fr_choice: 3,   // EN -> FR, QCM
	audio_to_en_choice: 2,// audio -> EN, QCM (nécessite "audio")
	audio_to_fr_choice: 2,// audio -> FR, QCM (nécessite "audio")
	audio_type_en: 1      // audio -> EN, réponse tapée (nécessite "audio")
};

const TYPE_LABELS = {
	fr_to_en_type: 'FR → EN (texte)',
	en_to_fr_choice: 'EN → FR (QCM)',
	audio_to_en_choice: 'Audio → EN (QCM)',
	audio_to_fr_choice: 'Audio → FR (QCM)',
	audio_type_en: 'Audio → EN (texte)'
};

const AUDIO_BLOCK_MS = 15 * 60 * 1000;
const STORAGE_PREFIX = 'vocab-';
const AUDIO_BLOCK_KEY = STORAGE_PREFIX + 'audioBlockedUntil';
const LAST_SETTINGS_KEY = STORAGE_PREFIX + 'lastSettings';

let DATA = null;
let POOL = [];
let TOTAL = 0;
let CURRENT = 0;
let SCORE = 0;
let REVIEW = [];
let CUR_TERM = null, CUR_TYPE = null;
let SELECTED_ANSWER_LOCKED = false;
let TERM_DECK = [];
let LAST_TERM = null;

const el = id => document.getElementById(id);

// ---- Thème ----
function initTheme() {
	const saved = localStorage.getItem(STORAGE_PREFIX + 'theme');
	const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
	applyTheme(theme);
	el('theme-toggle').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
	document.documentElement.dataset.theme = theme;
	localStorage.setItem(STORAGE_PREFIX + 'theme', theme);
	el('theme-toggle').textContent = theme === 'dark' ? 'Mode clair' : 'Mode sombre';
}

initTheme();

// ---- Réglage des poids dans l'interface ----
function buildWeightsUI() {
	const container = el('weights');
	container.innerHTML = Object.entries(WEIGHTS).map(([key, val]) => `
    <div class="weight-row">
      <label for="w-${key}">${TYPE_LABELS[key] || key}</label>
      <input type="number" id="w-${key}" min="0" max="10" step="1" value="${val}" data-type="${key}">
    </div>`).join('');
	container.querySelectorAll('input').forEach(inp => {
		inp.addEventListener('input', () => {
			WEIGHTS[inp.dataset.type] = Math.max(0, Math.round(+inp.value) || 0);
		});
	});
}

buildWeightsUI();

// ---- Stockage / restauration des settings du dernier quiz ----
function saveLastSettings() {
	const settings = {
		selectedCategories: [],
		infiniteMode: el('infinite-cb').checked
	};
	document.querySelectorAll('.cat-cb:checked').forEach(cb => {
		settings.selectedCategories.push({sem: cb.dataset.sem, cat: cb.dataset.cat});
	});
	if (!settings.infiniteMode) {
		settings.questionCount = +el('q-count').value;
	}
	localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(settings));
}

function restoreLastSettings() {
	try {
		const saved = JSON.parse(localStorage.getItem(LAST_SETTINGS_KEY));
		if (!saved) return;

		if (saved.infiniteMode) {
			el('infinite-cb').checked = true;
			el('q-count').disabled = true;
		} else if (saved.questionCount) {
			el('q-count').value = saved.questionCount;
		}

		if (Array.isArray(saved.selectedCategories)) {
			saved.selectedCategories.forEach(({sem, cat}) => {
				const cb = document.querySelector(`.cat-cb[data-sem="${sem}"][data-cat="${cat}"]`);
				if (cb) cb.checked = true;
			});
		}
	} catch (e) {
		// Ignore les erreurs de parsing
	}
}

// ---- Icônes SVG inline ----
const ICONS = {};

async function ensureIcon(name) {
	if (!ICONS[name]) {
		const res = await fetch(`assets/icons/${name}.svg`);
		ICONS[name] = res.ok ? await res.text() : '';
	}
	return ICONS[name];
}

async function renderIcons(root) {
	const nodes = root.querySelectorAll('[data-icon]');
	for (const n of nodes) n.innerHTML = await ensureIcon(n.dataset.icon);
}

// ---- Blocage audio ----
function isAudioBlocked() {
	const until = +localStorage.getItem(AUDIO_BLOCK_KEY);
	return until && Date.now() < until;
}

function blockAudio() {
	localStorage.setItem(AUDIO_BLOCK_KEY, Date.now() + AUDIO_BLOCK_MS);
}

fetch('vocab.json').then(r => r.json()).then(json => {
	DATA = json;
	buildSelectionUI();
	restoreLastSettings();
	updateStartState();
}).catch(() => {
	el('semesters').innerHTML = '<p>Impossible de charger vocab.json</p>';
});

function buildSelectionUI() {
	const container = el('semesters');
	container.innerHTML = '';
	DATA.terms.forEach((categories, sIdx) => {
		const details = document.createElement('details');
		details.className = 'semester';
		details.innerHTML = `<summary>Semestre ${sIdx + 1}</summary>
      <label class="select-all"><input type="checkbox" data-sem="${sIdx}" class="select-all-cb"> Tout sélectionner</label>`;
		categories.forEach((cat, cIdx) => {
			const row = document.createElement('div');
			row.className = 'cat-row';
			row.innerHTML = `<input type="checkbox" class="cat-cb" data-sem="${sIdx}" data-cat="${cIdx}">
        <label>${cat.name}</label><span class="count">${cat.list.length} mots</span>`;
			details.appendChild(row);
		});
		container.appendChild(details);
	});

	container.addEventListener('change', e => {
		if (e.target.classList.contains('select-all-cb')) {
			const sem = e.target.dataset.sem;
			container.querySelectorAll(`.cat-cb[data-sem="${sem}"]`).forEach(cb => cb.checked = e.target.checked);
		}
		updateStartState();
	});

	// Écouter les changements de poids pour mettre à jour le bouton start
	container.closest('section').querySelector('#weights').addEventListener('input', () => {
		updateStartState();
	});

	el('start-btn').addEventListener('click', startQuiz);
	el('next-btn').addEventListener('click', nextQuestion);
	el('restart-btn').addEventListener('click', () => location.reload());
}

function updateStartState() {
	const hasSelected = document.querySelectorAll('.cat-cb:checked').length > 0;
	const hasWeight = Object.values(WEIGHTS).some(w => w > 0);
	el('start-btn').disabled = !(hasSelected && hasWeight);
}

function buildPool() {
	POOL = [];
	document.querySelectorAll('.cat-cb:checked').forEach(cb => {
		const sIdx = +cb.dataset.sem, cIdx = +cb.dataset.cat;
		const cat = DATA.terms[sIdx][cIdx];
		cat.list.forEach(term => POOL.push({...term, category: cat.name}));
	});
}

// ---- Sélection de variantes anglaises ----
function randomEnVariant(term) {
	return term.en[Math.floor(Math.random() * term.en.length)];
}

function audioVariants(term) {
	return term.en.filter(w => w.audio);
}

function randomAudioVariant(term) {
	const v = audioVariants(term);
	return v[Math.floor(Math.random() * v.length)];
}

function hasAudio(term) {
	return audioVariants(term).length > 0;
}

function pickType(term) {
	const audioOk = hasAudio(term) && !isAudioBlocked();
	const entries = Object.entries(WEIGHTS)
		.filter(([t, weight]) => weight > 0 && (audioOk || !t.startsWith('audio_')));
	const total = entries.reduce((s, [, w]) => s + w, 0);

	if (total <= 0) {
		const fallback = Object.entries(WEIGHTS).filter(([t, w]) =>
			w > 0 && !t.startsWith('audio_')
		);
		if (!fallback.length) return 'fr_to_en_type';
		return fallback[Math.floor(Math.random() * fallback.length)][0];
	}

	let r = Math.random() * total;
	for (const [t, w] of entries) {
		if ((r -= w) < 0) return t;
	}
	return entries[entries.length - 1][0];
}

// extractor(term) -> string à utiliser comme distracteur
function randomDistractors(excludeTerm, extractor, n) {
	const pool = POOL.filter(t => t !== excludeTerm).map(extractor).filter(Boolean);
	const uniq = [...new Set(pool)];
	const out = [];
	while (out.length < n && uniq.length) {
		const i = Math.floor(Math.random() * uniq.length);
		out.push(uniq.splice(i, 1)[0]);
	}
	return out;
}

const frExtractor = t => t.fr[0];
const enExtractor = t => randomEnVariant(t).word;

function startQuiz() {
	buildPool();
	if (POOL.length === 0) return;
	const infinite = el('infinite-cb').checked;
	TOTAL = infinite ? Infinity : Math.min(+el('q-count').value || 15, POOL.length * 3);
	CURRENT = 0;
	SCORE = 0;
	REVIEW = [];
	TERM_DECK = shuffle(POOL);
	LAST_TERM = null;
	saveLastSettings();
	el('selection-screen').classList.add('hidden');
	el('quiz-screen').classList.remove('hidden');
	el('stop-btn').classList.toggle('hidden', !infinite);
	generateAndShowQuestion();
}

el('infinite-cb').addEventListener('change', e => {
	el('q-count').disabled = e.target.checked;
});
el('stop-btn').addEventListener('click', showResults);

// Entrée : valide la réponse une première fois, puis passe à la question suivante.
// Écouteur en phase de CAPTURE, posé sur document : il s'exécute avant le onkeydown
// de l'input (qui, lui, se déclenche pendant la phase "at target"). Comme ça, si la
// question est déjà verrouillée, on court-circuite l'événement avant qu'il n'atteigne
// l'input et ne déclenche une seconde validation dans la foulée.
document.addEventListener('keydown', e => {
	if (e.key !== 'Enter') return;
	if (SELECTED_ANSWER_LOCKED && !el('next-btn').classList.contains('hidden')) {
		e.preventDefault();
		e.stopPropagation();
		nextQuestion();
	}
}, true);

function audioBtnHTML(src) {
	return `<button type="button" class="audio-btn" data-audio="${src}"><span class="icon-wrap icon-sound" data-icon="sound"></span></button>`;
}

function cantListenHTML() {
	return `<button type="button" id="cant-listen-btn" class="link-btn">Je ne peux pas écouter</button>`;
}

function bindAudioControls() {
	document.querySelectorAll('.audio-btn').forEach(b => {
		b.onclick = () => new Audio(b.dataset.audio).play().catch(() => {
		});
	});
	const cant = el('cant-listen-btn');
	if (cant) cant.onclick = () => {
		blockAudio();
		generateAndShowQuestion();
	};
}

function drawTerm() {
	if (TERM_DECK.length === 0) {
		TERM_DECK = shuffle(POOL);

		// Évite de reprendre le dernier mot au début du nouveau paquet.
		if (TERM_DECK.length > 1 && TERM_DECK[0] === LAST_TERM) {
			const swapIndex = 1 + Math.floor(
				Math.random() * (TERM_DECK.length - 1)
			);
			[TERM_DECK[0], TERM_DECK[swapIndex]] =
				[TERM_DECK[swapIndex], TERM_DECK[0]];
		}
	}

	LAST_TERM = TERM_DECK.shift();
	return LAST_TERM;
}

function generateAndShowQuestion() {
	const term = drawTerm();
	CUR_TERM = term;
	CUR_TYPE = pickType(term);
	showQuestion();
}

function showQuestion() {
	SELECTED_ANSWER_LOCKED = false;
	el('feedback').classList.add('hidden');
	el('next-btn').classList.add('hidden');
	el('progress-text').textContent = `Question ${CURRENT + 1}${isFinite(TOTAL) ? ' / ' + TOTAL : ''} — Score: ${SCORE}`;
	const term = CUR_TERM, type = CUR_TYPE;
	const card = el('question-card');

	if (type === 'fr_to_en_type') {
		const accepted = term.en.map(w => w.word);
		card.innerHTML = `<div class="prompt">${term.fr.join(' / ')}</div>
      <p class="hint">Écris le mot en anglais</p>
      <div class="type-row"><input type="text" id="answer-input" autocomplete="off"><button id="submit-btn">Valider</button></div>`;
		el('submit-btn').onclick = () => checkTyped(el('answer-input').value, accepted);
		el('answer-input').onkeydown = e => {
			if (e.key === 'Enter') checkTyped(el('answer-input').value, accepted);
		};
		el('answer-input').focus();
	} else if (type === 'audio_type_en') {
		const variant = randomAudioVariant(term);
		card.innerHTML = `<p class="hint">Écoute et écris le mot en anglais</p>
      ${audioBtnHTML(variant.audio)}
      <div class="type-row"><input type="text" id="answer-input" autocomplete="off"><button id="submit-btn">Valider</button></div>
      <div style="margin-top:10px">${cantListenHTML()}</div>`;
		el('submit-btn').onclick = () => checkTyped(el('answer-input').value, [variant.word], term.fr[0]);
		el('answer-input').onkeydown = e => {
			if (e.key === 'Enter') checkTyped(el('answer-input').value, [variant.word], term.fr[0]);
		};
		bindAudioControls();
		renderIcons(card);
	} else if (type === 'en_to_fr_choice' || type === 'audio_to_fr_choice') {
		const correct = term.fr[0];
		const choices = shuffle([correct, ...randomDistractors(term, frExtractor, 3)]);
		let head = '';
		let textHint = '';
		if (type === 'en_to_fr_choice') {
			const variant = randomEnVariant(term);
			head = `<div class="prompt">${variant.word}</div>${variant.phonetic ? `<div class="phonetic">/${variant.phonetic}/</div>` : ''}${variant.audio ? audioBtnHTML(variant.audio) : ''}`;
		} else {
			const variant = randomAudioVariant(term);
			head = `<p class="hint">Écoute et choisis la traduction</p>${audioBtnHTML(variant.audio)}<div>${cantListenHTML()}</div>`;
			textHint = variant.word;
		}
		card.innerHTML = head + `<div class="choices">${choices.map(c => `<button class="choice-btn">${c}</button>`).join('')}</div>`;
		bindChoices(correct, [correct], textHint);
		bindAudioControls();
		renderIcons(card);
	} else if (type === 'audio_to_en_choice') {
		const variant = randomAudioVariant(term);
		const correct = variant.word;
		const choices = shuffle([correct, ...randomDistractors(term, enExtractor, 3)]);
		card.innerHTML = `<p class="hint">Écoute et choisis le mot en anglais</p>${audioBtnHTML(variant.audio)}<div>${cantListenHTML()}</div>
      <div class="choices">${choices.map(c => `<button class="choice-btn">${c}</button>`).join('')}</div>`;
		bindChoices(correct, [correct], term.fr[0]);
		bindAudioControls();
		renderIcons(card);
	}
}

function getChoiceTranslation(choice, type) {
	if (type === 'en_to_fr_choice' || type === 'audio_to_fr_choice') {
		const term = POOL.find(t =>
			t.fr.some(fr => normalize(fr) === normalize(choice))
		);
		return term ? term.en.map(w => w.word).join(' / ') : '';
	}

	if (type === 'audio_to_en_choice') {
		const term = POOL.find(t =>
			t.en.some(en => normalize(en.word) === normalize(choice))
		);
		return term ? term.fr.join(' / ') : '';
	}

	return '';
}

function revealChoiceTranslations() {
	document.querySelectorAll('.choice-btn').forEach(btn => {
		const choice = btn.dataset.choice;
		const translation = getChoiceTranslation(choice, CUR_TYPE);

		if (!translation || btn.querySelector('.choice-translation')) return;

		const span = document.createElement('span');
		span.className = 'choice-translation';
		span.textContent = ` — ${translation}`;
		btn.appendChild(span);
	});
}

function bindChoices(correct, acceptedList, textHint) {
	document.querySelectorAll('.choice-btn').forEach(btn => {
		btn.dataset.choice = btn.textContent.trim();

		btn.onclick = () => {
			if (SELECTED_ANSWER_LOCKED) return;
			SELECTED_ANSWER_LOCKED = true;

			const selected = btn.dataset.choice;
			const ok = normalize(selected) === normalize(correct);
			btn.classList.add(ok ? 'correct' : 'wrong');

			if (!ok) {
				document.querySelectorAll('.choice-btn').forEach(b => {
					if (normalize(b.dataset.choice) === normalize(correct)) {
						b.classList.add('correct');
					}
				});
			}

			revealChoiceTranslations();
			registerResult(ok, acceptedList.join(' / '), textHint);
		};
	});
}

function normalize(s) {
	return s.trim().toLowerCase();
}

// Enlève le contenu entre parenthèses (y compris imbriquées), ex: "Cart (US) (trolley (UK))" -> "Cart"
function stripParens(s) {
	let prev;
	do {
		prev = s;
		s = s.replace(/\([^()]*\)/g, '');
	} while (s !== prev);
	return s.replace(/\s+/g, ' ').trim();
}

function checkTyped(value, acceptedList, text) {
	if (SELECTED_ANSWER_LOCKED) return;
	SELECTED_ANSWER_LOCKED = true;
	const ok = acceptedList.some(a => normalize(stripParens(a)) === normalize(value));
	registerResult(ok, acceptedList.join(' / '), text);
}

function registerResult(ok, correctText, text) {
	if (ok) SCORE++;
	REVIEW.push({term: CUR_TERM, ok, correctText});
	const fb = el('feedback');
	fb.classList.remove('hidden', 'ok', 'ko');
	fb.classList.add(ok ? 'ok' : 'ko');
	const mainText = ok ? 'Correct !' : `Faux — réponse : ${correctText}`;
	const textHint = text ? ` <span class="text-hint">(${text})</span>` : '';
	fb.innerHTML = `<span class="icon-wrap ${ok ? 'icon-correct' : 'icon-wrong'}" data-icon="${ok ? 'correct' : 'wrong'}"></span>
    <span>${mainText}${textHint}</span>`;
	renderIcons(fb);
	el('next-btn').classList.remove('hidden');
}

function nextQuestion() {
	CURRENT++;
	if (CURRENT >= TOTAL) return showResults();
	generateAndShowQuestion();
}

function showResults() {
	el('quiz-screen').classList.add('hidden');
	el('results-screen').classList.remove('hidden');
	el('score-text').textContent = `${SCORE} / ${REVIEW.length}`;
	const rev = el('review');
	rev.innerHTML = REVIEW.map(q => `
    <div class="item ${q.ok ? '' : 'ko'}">
      <span class="icon-wrap ${q.ok ? 'icon-correct' : 'icon-wrong'}" data-icon="${q.ok ? 'correct' : 'wrong'}"></span>
      <span><strong>${q.term.en.map(w => w.word).join(' / ')}</strong> — ${q.term.fr.join(' / ')}</span>
    </div>`).join('');
	renderIcons(rev);
}

function shuffle(arr) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}
