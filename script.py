import json
import re
import time
from pathlib import Path
from urllib.parse import quote

import requests
from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

INPUT_FILE = "vocab.json"
OUTPUT_FILE = "vocab_2.json"
AUDIO_DIR = Path("assets/audio")

LOG_FILE = "logs"

WIKTIONARY_URL = "https://en.wiktionary.org/wiki/{}"

HEADERS = {
	"User-Agent": "EnglishVocabularyGenerator/1.0"
}


def create_driver():
	options = Options()

	# Pas de fenêtre Chrome
	options.add_argument("--headless")

	# Nécessaire dans certains environnements Linux/Docker
	options.add_argument("--no-sandbox")
	options.add_argument("--disable-dev-shm-usage")

	options.add_argument("--disable-gpu")

	return webdriver.Chrome(options=options)


def log_missing(word: str, reason: str):
	with open(LOG_FILE, "a", encoding="utf-8") as file:
		file.write(f"{word}\t{reason}\n")


def clean_ipa(text: str) -> str:
	"""
	Convertit par exemple :

		/əˈbrɔːd/ -> əˈbrɔːd
		[əˈbrɔːd] -> əˈbrɔːd
	"""

	text = text.strip()

	if len(text) >= 2:
		if (
				(text.startswith("/") and text.endswith("/"))
				or
				(text.startswith("[") and text.endswith("]"))
		):
			text = text[1:-1]

	return text.strip()


def find_english_section(driver):
	"""
	Trouve la section English de Wiktionary.

	Exemple de structure :

	<h2 id="English">English</h2>
	"""

	try:
		heading = driver.find_element(
			By.CSS_SELECTOR,
			"h2#English"
		)

		return heading

	except NoSuchElementException:
		return None


def extract_ipa(driver, english_heading):
	"""
	Cherche les éléments IPA dans la section English.

	On limite la recherche aux éléments situés après
	le heading English et avant le prochain h2.
	"""

	try:
		section = english_heading.find_element(
			By.XPATH,
			"./following-sibling::*[self::section or self::h2]"
		)
	except NoSuchElementException:
		section = None

	# Méthode plus robuste :
	# récupérer les éléments .IPA après English jusqu'au prochain h2.

	elements = driver.find_elements(
		By.CSS_SELECTOR,
		".IPA"
	)

	heading_position = english_heading.location["y"]

	candidates = []

	for element in elements:
		try:
			if not element.is_displayed():
				continue

			element_position = element.location["y"]

			# Le IPA doit être après le heading English
			if element_position <= heading_position:
				continue

			candidates.append(element)

		except Exception:
			continue

	if not candidates:
		return None

	return clean_ipa(
		candidates[0].text
	)


def extract_audio(driver):
	try:
		play_button = driver.find_element(
			By.CSS_SELECTOR,
			"a.mw-tmh-play"
		)

		href = play_button.get_attribute("href")

		if not href:
			return None

		driver.get(href)

		original_file = driver.find_element(
			By.XPATH,
			"//a[contains(normalize-space(.), 'Original file')]"
		)

		return original_file.get_attribute("href")

	except NoSuchElementException:
		return None


def get_audio_url(driver):
	"""
	Récupère l'URL du fichier audio.

	Si Wiktionary donne un lien Special:Redirect/file,
	on laisse requests suivre la redirection.
	"""

	url = extract_audio(
		driver
	)

	if not url:
		return None

	return url


def safe_filename(word: str) -> str:
	"""
	Transforme un mot en nom de fichier sûr.
	"""

	filename = re.sub(
		r"[^a-zA-Z0-9_-]+",
		"_",
		word
	)

	return filename.strip("_")


def download_audio(word: str, url: str) -> str | None:
	"""
	Télécharge le fichier audio dans assets/audio/.
	"""

	filename = safe_filename(word)

	# On essaie de conserver l'extension originale.
	match = re.search(
		r"\.(ogg|oga|mp3|wav|opus)(?:$|\?)",
		url,
		re.IGNORECASE
	)

	extension = (
		"." + match.group(1).lower()
		if match
		else ".ogg"
	)

	output_path = AUDIO_DIR / f"{filename}{extension}"

	# Évite de télécharger deux fois le même fichier.
	if output_path.exists():
		print(f"  [=] Audio already exists: {output_path}")

		return output_path.as_posix()

	print(f"  [↓] Downloading: {url}")

	while True:
		response = requests.get(
			url,
			headers=HEADERS,
			timeout=30,
			allow_redirects=True
		)

		if response.status_code == 429:
			retry_after = response.headers.get("Retry-After")

			if retry_after:
				delay = int(retry_after)
			else:
				delay = 10

			print(
				f"  [!] Rate limited, waiting {delay}s..."
			)

			time.sleep(delay)
			continue

		response.raise_for_status()
		break

	with open(output_path, "wb") as file:
		file.write(response.content)

	return output_path.as_posix()


def process_word(driver, word: str | dict) -> dict:
	if isinstance(word, dict):
		result = word.copy()
		original_word = result["word"]
	else:
		result = {
			"word": word,
			"phonetic": None,
			"audio": None
		}

		original_word = word

	needs_phonetic = not result.get("phonetic")
	needs_audio = not result.get("audio")

	if not needs_phonetic and not needs_audio:
		return result

	normalized_word = original_word

	while "(" in normalized_word:
		normalized_word = re.sub(r"\([^()]*\)", "", normalized_word)

	normalized_word = normalized_word.strip().lower()

	print(f"\nProcessing: {original_word}")
	print(f"  Normalized word: {normalized_word}")

	url = WIKTIONARY_URL.format(
		quote(normalized_word, safe="")
	)

	driver.get(url)

	# ---------------------------------------------------------
	# English section
	# ---------------------------------------------------------

	english_heading = find_english_section(driver)

	if english_heading is None:
		print("  [!] English section not found")
		log_missing(original_word, "English section not found")

		return result

	# ---------------------------------------------------------
	# IPA
	# ---------------------------------------------------------

	if needs_phonetic:

		phonetic = extract_ipa(
			driver,
			english_heading
		)

		if phonetic:
			result["phonetic"] = phonetic

			print(f"  [✓] IPA: {phonetic}")

		else:
			print("  [!] IPA not found")

			log_missing(original_word, "IPA not found")

	# ---------------------------------------------------------
	# Audio
	# ---------------------------------------------------------

	if needs_audio:

		audio_url = get_audio_url(driver)

		if audio_url:

			try:
				audio_path = download_audio(
					normalized_word,
					audio_url
				)

				result["audio"] = audio_path

				print(f"  [✓] Audio: {audio_path}")

			except requests.RequestException as error:
				print(
					f"  [!] Audio download failed: {error}"
				)

		else:
			print("  [!] Audio not found")

			log_missing(original_word, "Audio not found")

	return result


def process_json(driver, data):
	"""
	Parcourt :

		terms
		└── semester
			└── term
				└── list
					└── en
	"""

	cache = {}

	for semester in data.get("terms", []):

		for term in semester:

			for entry in term.get("list", []):

				words = entry.get("en", [])

				new_words = []

				for word in words:

					# Permet de relancer le script
					# sur un JSON déjà traité.
					if isinstance(word, dict):
						word_key = word.get("word")
					else:
						word_key = word

					# Plusieurs occurrences d'un même mot
					# ne déclenchent qu'une seule requête.
					if word_key not in cache:
						cache[word_key] = process_word(
							driver,
							word
						)

					new_words.append(
						cache[word_key]
					)

				entry["en"] = new_words

	return data


def main():
	AUDIO_DIR.mkdir(
		parents=True,
		exist_ok=True
	)

	# ---------------------------------------------------------
	# JSON
	# ---------------------------------------------------------

	print(f"Loading {INPUT_FILE}...")

	with open(
			INPUT_FILE,
			"r",
			encoding="utf-8"
	) as file:

		data = json.load(file)

	# ---------------------------------------------------------
	# Selenium
	# ---------------------------------------------------------

	driver = create_driver()

	try:

		data = process_json(
			driver,
			data
		)

	finally:

		driver.quit()

	# ---------------------------------------------------------
	# Save
	# ---------------------------------------------------------

	print(f"\nSaving {OUTPUT_FILE}...")

	with open(
			OUTPUT_FILE,
			"w",
			encoding="utf-8"
	) as file:

		json.dump(
			data,
			file,
			ensure_ascii=False,
			indent=4
		)

	print("Done!")


if __name__ == "__main__":
	main()
