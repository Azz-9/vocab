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
const AUDIO_BLOCK_KEY = 'audioBlockedUntil';

let DATA = null;
let POOL = [];
let TOTAL = 0;
let CURRENT = 0;
let SCORE = 0;
let REVIEW = [];
let CUR_TERM = null, CUR_TYPE = null;
let SELECTED_ANSWER_LOCKED = false;

const el = id => document.getElementById(id);

// ---- Thème ----
function initTheme() {
	const saved = localStorage.getItem('theme');
	const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
	applyTheme(theme);
	el('theme-toggle').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
	document.documentElement.dataset.theme = theme;
	localStorage.setItem('theme', theme);
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
}).catch(() => {
	el('semesters').innerHTML = '<p>Impossible de charger vocab.json</p>';
});

function buildSelectionUI() {
	const container = el('semesters');
	container.innerHTML = '';
	DATA.terms.forEach((categories, sIdx) => {
		const div = document.createElement('div');
		div.className = 'semester';
		div.innerHTML = `<h3>Semestre ${sIdx + 1}</h3>
      <label class="select-all"><input type="checkbox" data-sem="${sIdx}" class="select-all-cb"> Tout sélectionner</label>`;
		categories.forEach((cat, cIdx) => {
			const row = document.createElement('div');
			row.className = 'cat-row';
			row.innerHTML = `<input type="checkbox" class="cat-cb" data-sem="${sIdx}" data-cat="${cIdx}">
        <label>${cat.name}</label><span class="count">${cat.list.length} mots</span>`;
			div.appendChild(row);
		});
		container.appendChild(div);
	});

	container.addEventListener('change', e => {
		if (e.target.classList.contains('select-all-cb')) {
			const sem = e.target.dataset.sem;
			container.querySelectorAll(`.cat-cb[data-sem="${sem}"]`).forEach(cb => cb.checked = e.target.checked);
		}
		updateStartState();
	});

	el('start-btn').addEventListener('click', startQuiz);
	el('next-btn').addEventListener('click', nextQuestion);
	el('restart-btn').addEventListener('click', () => location.reload());
}

function updateStartState() {
	el('start-btn').disabled = document.querySelectorAll('.cat-cb:checked').length === 0;
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
	const entries = Object.entries(WEIGHTS).filter(([t]) => audioOk || !t.startsWith('audio_'));
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let r = Math.random() * total;
	for (const [t, w] of entries) {
		if ((r -= w) <= 0) return t;
	}
	return entries[0][0];
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
	const infinite = el('infinite-cb').checked;
	TOTAL = infinite ? Infinity : Math.min(+el('q-count').value || 15, POOL.length * 3);
	CURRENT = 0;
	SCORE = 0;
	REVIEW = [];
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

function generateAndShowQuestion() {
	const term = POOL[Math.floor(Math.random() * POOL.length)];
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
		el('submit-btn').onclick = () => checkTyped(el('answer-input').value, [variant.word]);
		el('answer-input').onkeydown = e => {
			if (e.key === 'Enter') checkTyped(el('answer-input').value, [variant.word]);
		};
		bindAudioControls();
		renderIcons(card);
	} else if (type === 'en_to_fr_choice' || type === 'audio_to_fr_choice') {
		const correct = term.fr[0];
		const choices = shuffle([correct, ...randomDistractors(term, frExtractor, 3)]);
		let head = '';
		if (type === 'en_to_fr_choice') {
			const variant = randomEnVariant(term);
			head = `<div class="prompt">${variant.word}</div>${variant.phonetic ? `<div class="phonetic">/${variant.phonetic}/</div>` : ''}${variant.audio ? audioBtnHTML(variant.audio) : ''}`;
		} else {
			const variant = randomAudioVariant(term);
			head = `<p class="hint">Écoute et choisis la traduction</p>${audioBtnHTML(variant.audio)}<div>${cantListenHTML()}</div>`;
		}
		card.innerHTML = head + `<div class="choices">${choices.map(c => `<button class="choice-btn">${c}</button>`).join('')}</div>`;
		bindChoices(correct, [correct]);
		bindAudioControls();
		renderIcons(card);
	} else if (type === 'audio_to_en_choice') {
		const variant = randomAudioVariant(term);
		const correct = variant.word;
		const choices = shuffle([correct, ...randomDistractors(term, enExtractor, 3)]);
		card.innerHTML = `<p class="hint">Écoute et choisis le mot en anglais</p>${audioBtnHTML(variant.audio)}<div>${cantListenHTML()}</div>
      <div class="choices">${choices.map(c => `<button class="choice-btn">${c}</button>`).join('')}</div>`;
		bindChoices(correct, [correct]);
		bindAudioControls();
		renderIcons(card);
	}
}

function bindChoices(correct, acceptedList) {
	document.querySelectorAll('.choice-btn').forEach(btn => {
		btn.onclick = () => {
			if (SELECTED_ANSWER_LOCKED) return;
			SELECTED_ANSWER_LOCKED = true;
			const ok = normalize(btn.textContent) === normalize(correct);
			btn.classList.add(ok ? 'correct' : 'wrong');
			if (!ok) {
				document.querySelectorAll('.choice-btn').forEach(b => {
					if (normalize(b.textContent) === normalize(correct)) b.classList.add('correct');
				});
			}
			registerResult(ok, acceptedList.join(' / '));
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

function checkTyped(value, acceptedList) {
	if (SELECTED_ANSWER_LOCKED) return;
	SELECTED_ANSWER_LOCKED = true;
	const ok = acceptedList.some(a => normalize(stripParens(a)) === normalize(value));
	registerResult(ok, acceptedList.join(' / '));
}

function registerResult(ok, correctText) {
	if (ok) SCORE++;
	REVIEW.push({term: CUR_TERM, ok, correctText});
	const fb = el('feedback');
	fb.classList.remove('hidden', 'ok', 'ko');
	fb.classList.add(ok ? 'ok' : 'ko');
	fb.innerHTML = `<span class="icon-wrap ${ok ? 'icon-correct' : 'icon-wrong'}" data-icon="${ok ? 'correct' : 'wrong'}"></span>
    <span>${ok ? 'Correct !' : `Faux — réponse : ${correctText}`}</span>`;
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
