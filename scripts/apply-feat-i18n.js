/**
 * Merge feature-card i18n keys into all language packs + rebuild.
 * node scripts/apply-feat-i18n.js && node scripts/build-i18n.js
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "i18n-data");
const base = require("./i18n-feat-cards.json");

// Extra languages: full HTML packs derived from English with translations
const more = {
  de: {
    "feat.menuAria": "ClipForge Hauptfunktionen",
    "feat.close": "Beschreibung schließen",
    "feat.delogo.cardTitle": "1 · Sauberes Bild",
    "feat.delogo.cardDesc": "Logos und Wasserzeichen entfernen",
    "feat.delogo.title": "1 · Sauberes Bild",
    "feat.delogo.html":
      "<p><strong>Logos, Wasserzeichen und Overlays entfernen</strong> — ohne manuelles CapCut-Editing.</p><ul><li><strong>Manuelle Auswahl</strong> — Rechteck(e) auf dem Frame um das Logo zeichnen.</li><li><strong>Auto (unten)</strong> — schneller Fix für typische untere Wasserzeichen.</li><li><strong>Methoden:</strong> Delogo (natürlich), schwarzer Balken (100 % Abdeckung), Blur + stärkeres Cover.</li><li>Mehrere Bereiche — mehrere Logos in einem Video.</li></ul><p class='feature-cta'>→ Spalte 1 · Video-Optionen · „Logo / Wasserzeichen entfernen“</p>",
    "feat.hd.cardTitle": "2 · Super HD / KI",
    "feat.hd.cardDesc": "Schnell-HD + Real-ESRGAN x4plus",
    "feat.hd.title": "2 · Super HD / KI",
    "feat.hd.html":
      "<p><strong>Qualität auf scharfes HD heben</strong> — von schnellem FFmpeg bis starkem Real-ESRGAN.</p><ul><li><strong>Schnell-HD</strong> — Scale + Schärfe + Denoise + Farbe (auto oder manuell).</li><li><strong>KI Real-ESRGAN</strong> auf Ihrem PC (Agent): Anime/Video und <strong>Fotoreal x4plus</strong>.</li><li><strong>x4plus</strong> — besser für echte Personen/Videos; Modell muss auf dem PC liegen; langsamer als Anime/Video.</li><li><strong>Stil &amp; Bild:</strong> Cartoon, Cinematic, VHS, Noir, 9:16 Reels, 1:1, Stabilisieren, Tempo, max 15/30/60 s.</li><li><strong>VORHER / NACHHER</strong> mit zwei Playern im Ergebnis.</li></ul><p class='feature-cta'>→ Spalte 1 · Qualität &amp; Auflösung · Videostil &amp; Bildausschnitt</p>",
    "feat.voice.cardTitle": "3 · Sprecher & Untertitel",
    "feat.voice.cardDesc": "STT · Übersetzung · TTS · SRT",
    "feat.voice.title": "3 · Sprecher & Untertitel",
    "feat.voice.html":
      "<p><strong>Aus dem Video-Audio werden Sprecher und untertitelreife Texte</strong> — in vielen Sprachen.</p><ul><li><strong>Sprache aus dem Ton erkennen</strong> — STT in Segmenten aus dem Originalaudio.</li><li><strong>Untertitel aus dem Video</strong> — YouTube/auto-CC → Text mit Zeit.</li><li><strong>Live-Übersetzung</strong> in die Zielsprache (z. B. PL, EN, ES…).</li><li><strong>Neuraler Sprecher</strong> (weiblich / männlich) gemischt mit Hintergrund.</li><li><strong>SRT-Untertitel</strong> + optional Burn-in.</li><li><strong>Audio verbessern:</strong> Lautstärke, Bass/Höhen, Denoise, Stimme, Bitrate.</li></ul><p class='feature-cta'>→ Spalte 2 · Sprecher · Audioqualität · Untertitel</p>",
    "feat.pc.cardTitle": "4 · Ihr PC",
    "feat.pc.cardDesc": "Lokaler Agent · Privatsphäre · keine Warteschlange",
    "feat.pc.title": "4 · Ihr PC",
    "feat.pc.html":
      "<p><strong>UI in der Cloud, Rechnen bei Ihnen</strong> — ohne gemeinsame Warteschlange und ohne Dauer-Speicher Ihrer Videos auf dem Server.</p><ul><li><strong>PC-Agent</strong> — eine Datei ⬇ PC, Installation aus der Cloud, Jobs auf Ihrem Rechner.</li><li><strong>Chip PC · ON</strong> — sehen, wann der Agent mit Ihrem Konto verbunden ist.</li><li><strong>Privatsphäre</strong> — Arbeitsdateien lokal; große Ergebnisse bleiben auf der Festplatte (Localhost-Vorschau), kein 500‑MB-Cloud-Limit.</li><li><strong>Multi-User</strong> — jeder hat Konto, Token und eigene Jobs.</li></ul><p class='feature-cta'>→ Studio · Schaltfläche ⬇ PC · RUN-AGENT.bat</p>",
  },
  es: {
    "feat.menuAria": "Funciones principales de ClipForge",
    "feat.close": "Cerrar descripción",
    "feat.delogo.cardTitle": "1 · Imagen limpia",
    "feat.delogo.cardDesc": "Quitar logos y marcas de agua",
    "feat.delogo.title": "1 · Imagen limpia",
    "feat.delogo.html":
      "<p><strong>Quitar logos, marcas de agua y overlays</strong> — sin montaje manual en CapCut.</p><ul><li><strong>Selección manual</strong> — dibuja rectángulo(s) en el fotograma donde está el logo.</li><li><strong>Auto (abajo)</strong> — arreglo rápido de watermarks típicos abajo.</li><li><strong>Métodos:</strong> delogo (natural), barra negra (100 % cubre), blur + más cobertura.</li><li>Varias zonas — varios logos en un vídeo.</li></ul><p class='feature-cta'>→ Columna 1 · Opciones de vídeo · “Quitar logo / marca de agua”</p>",
    "feat.hd.cardTitle": "2 · Super HD / IA",
    "feat.hd.cardDesc": "HD rápido + Real-ESRGAN x4plus",
    "feat.hd.title": "2 · Super HD / IA",
    "feat.hd.html":
      "<p><strong>Sube la calidad a HD nítido</strong> — de FFmpeg rápido a Real-ESRGAN potente.</p><ul><li><strong>HD rápido</strong> — scale + nitidez + denoise + color (auto o manual).</li><li><strong>IA Real-ESRGAN</strong> en tu PC (agente): modelos Anime/Video y <strong>Fotorreal x4plus</strong>.</li><li><strong>x4plus</strong> — mejor para personas/vídeo real; el modelo debe estar en el PC; más lento que Anime/Video.</li><li><strong>Estilo y encuadre:</strong> Cartoon, Cinematic, VHS, Noir, 9:16 Reels, 1:1, estabilizar, velocidad, máx 15/30/60 s.</li><li>Comparación <strong>ANTES / DESPUÉS</strong> con dos reproductores.</li></ul><p class='feature-cta'>→ Columna 1 · Calidad y resolución · Estilo y encuadre</p>",
    "feat.voice.cardTitle": "3 · Narrador y subtítulos",
    "feat.voice.cardDesc": "STT · traducir · TTS · SRT",
    "feat.voice.title": "3 · Narrador y subtítulos",
    "feat.voice.html":
      "<p><strong>Del audio del vídeo sacas narrador y subtítulos listos para publicar</strong> — en muchos idiomas.</p><ul><li><strong>Reconocer el habla del audio</strong> — STT por segmentos del audio original.</li><li><strong>Usar subtítulos del vídeo</strong> — YouTube/auto-CC → texto con tiempo.</li><li><strong>Traducción en vivo</strong> al idioma destino (p. ej. PL, EN, ES…).</li><li><strong>Narrador neural</strong> (femenino / masculino) mezclado con el fondo.</li><li><strong>Subtítulos SRT</strong> + burn-in opcional.</li><li><strong>Mejora de audio:</strong> volumen, graves/agudos, denoise, foco en voz, bitrate.</li></ul><p class='feature-cta'>→ Columna 2 · Narrador · Calidad de audio · Subtítulos</p>",
    "feat.pc.cardTitle": "4 · Tu PC",
    "feat.pc.cardDesc": "Agente local · privacidad · sin cola",
    "feat.pc.title": "4 · Tu PC",
    "feat.pc.html":
      "<p><strong>UI en la nube, cálculo en tu máquina</strong> — sin cola compartida y sin guardar tus vídeos para siempre en el servidor.</p><ul><li><strong>Agente PC</strong> — un archivo ⬇ PC, instalación desde la nube, jobs en tu ordenador.</li><li><strong>Chip PC · ON</strong> — ves cuándo el agente está unido a tu cuenta.</li><li><strong>Privacidad</strong> — archivos de trabajo en local; resultados grandes en disco (vista previa localhost), sin límite de 500 MB en la nube.</li><li><strong>Multi-usuario</strong> — cada uno tiene cuenta, token y jobs propios.</li></ul><p class='feature-cta'>→ Studio · botón ⬇ PC · RUN-AGENT.bat</p>",
  },
  fr: {
    "feat.menuAria": "Fonctions principales de ClipForge",
    "feat.close": "Fermer la description",
    "feat.delogo.cardTitle": "1 · Image propre",
    "feat.delogo.cardDesc": "Supprimer logos et filigranes",
    "feat.delogo.title": "1 · Image propre",
    "feat.delogo.html":
      "<p><strong>Supprimer logos, filigranes et overlays</strong> — sans montage manuel dans CapCut.</p><ul><li><strong>Sélection manuelle</strong> — dessinez le(s) rectangle(s) sur l’image où se trouve le logo.</li><li><strong>Auto (bas)</strong> — retouche rapide des filigranes bas de cadre.</li><li><strong>Méthodes :</strong> delogo (naturel), barre noire (100 % de couverture), flou + couverture plus forte.</li><li>Plusieurs zones — plusieurs logos sur une vidéo.</li></ul><p class='feature-cta'>→ Colonne 1 · Options vidéo · « Supprimer logo / filigrane »</p>",
    "feat.hd.cardTitle": "2 · Super HD / IA",
    "feat.hd.cardDesc": "HD rapide + Real-ESRGAN x4plus",
    "feat.hd.title": "2 · Super HD / IA",
    "feat.hd.html":
      "<p><strong>Passez en HD nette</strong> — du FFmpeg rapide au Real-ESRGAN puissant.</p><ul><li><strong>HD rapide</strong> — scale + netteté + denoise + couleur (auto ou manuel).</li><li><strong>IA Real-ESRGAN</strong> sur votre PC (agent) : modèles Anime/Vidéo et <strong>Photoréal x4plus</strong>.</li><li><strong>x4plus</strong> — mieux pour vraies personnes/vidéo ; le modèle doit être sur le PC ; plus lent qu’Anime/Vidéo.</li><li><strong>Style &amp; cadre :</strong> Cartoon, Cinematic, VHS, Noir, 9:16 Reels, 1:1, stabilisation, tempo, max 15/30/60 s.</li><li>Comparaison <strong>AVANT / APRÈS</strong> avec deux lecteurs.</li></ul><p class='feature-cta'>→ Colonne 1 · Qualité &amp; résolution · Style et cadrage</p>",
    "feat.voice.cardTitle": "3 · Narrateur & sous-titres",
    "feat.voice.cardDesc": "STT · traduire · TTS · SRT",
    "feat.voice.title": "3 · Narrateur & sous-titres",
    "feat.voice.html":
      "<p><strong>De l’audio de la vidéo : narrateur et sous-titres prêts à publier</strong> — en plusieurs langues.</p><ul><li><strong>Reconnaître la parole dans l’audio</strong> — STT par segments sur l’audio original.</li><li><strong>Prendre les sous-titres de la vidéo</strong> — YouTube/auto-CC → texte horodaté.</li><li><strong>Traduction en direct</strong> vers la langue cible (ex. PL, EN, ES…).</li><li><strong>Narrateur neural</strong> (féminin / masculin) mixé avec le fond.</li><li><strong>Sous-titres SRT</strong> + burn-in optionnel.</li><li><strong>Amélioration audio :</strong> volume, graves/aigus, denoise, focus voix, débit.</li></ul><p class='feature-cta'>→ Colonne 2 · Narrateur · Qualité audio · Sous-titres</p>",
    "feat.pc.cardTitle": "4 · Votre PC",
    "feat.pc.cardDesc": "Agent local · confidentialité · sans file",
    "feat.pc.title": "4 · Votre PC",
    "feat.pc.html":
      "<p><strong>UI dans le cloud, calcul chez vous</strong> — sans file d’attente partagée ni stockage permanent de vos vidéos sur le serveur.</p><ul><li><strong>Agent PC</strong> — un fichier ⬇ PC, installation depuis le cloud, jobs sur votre machine.</li><li><strong>Chip PC · ON</strong> — sachez quand l’agent est lié à votre compte.</li><li><strong>Confidentialité</strong> — fichiers de travail en local ; gros résultats sur le disque (aperçu localhost), pas de limite 500 Mo cloud.</li><li><strong>Multi-utilisateur</strong> — chacun son compte, son token, ses jobs.</li></ul><p class='feature-cta'>→ Studio · bouton ⬇ PC · RUN-AGENT.bat</p>",
  },
  it: {
    "feat.menuAria": "Funzioni principali di ClipForge",
    "feat.close": "Chiudi descrizione",
    "feat.delogo.cardTitle": "1 · Immagine pulita",
    "feat.delogo.cardDesc": "Rimuovi loghi e watermark",
    "feat.delogo.title": "1 · Immagine pulita",
    "feat.delogo.html":
      "<p><strong>Rimuovi loghi, watermark e overlay</strong> — senza montaggio manuale in CapCut.</p><ul><li><strong>Selezione manuale</strong> — disegna rettangolo/i sul fotogramma dove c’è il logo.</li><li><strong>Auto (basso)</strong> — ritocco rapido dei watermark in basso.</li><li><strong>Metodi:</strong> delogo (naturale), barra nera (copertura 100%), blur + copertura più forte.</li><li>Più aree — più loghi nello stesso video.</li></ul><p class='feature-cta'>→ Colonna 1 · Opzioni video · “Rimuovi logo / watermark”</p>",
    "feat.hd.cardTitle": "2 · Super HD / IA",
    "feat.hd.cardDesc": "HD veloce + Real-ESRGAN x4plus",
    "feat.hd.title": "2 · Super HD / IA",
    "feat.hd.html":
      "<p><strong>Porta la qualità a un HD nitido</strong> — da FFmpeg veloce a Real-ESRGAN potente.</p><ul><li><strong>HD veloce</strong> — scale + nitidezza + denoise + colore (auto o manuale).</li><li><strong>IA Real-ESRGAN</strong> sul tuo PC (agente): modelli Anime/Video e <strong>Fotoreale x4plus</strong>.</li><li><strong>x4plus</strong> — meglio per persone/video reali; il modello deve essere sul PC; più lento di Anime/Video.</li><li><strong>Stile e inquadratura:</strong> Cartoon, Cinematic, VHS, Noir, 9:16 Reels, 1:1, stabilizza, velocità, max 15/30/60 s.</li><li>Confronto <strong>PRIMA / DOPO</strong> con due player.</li></ul><p class='feature-cta'>→ Colonna 1 · Qualità e risoluzione · Stile e inquadratura</p>",
    "feat.voice.cardTitle": "3 · Narratore e sottotitoli",
    "feat.voice.cardDesc": "STT · traduci · TTS · SRT",
    "feat.voice.title": "3 · Narratore e sottotitoli",
    "feat.voice.html":
      "<p><strong>Dall’audio del video ottieni narratore e sottotitoli pronti alla pubblicazione</strong> — in molte lingue.</p><ul><li><strong>Riconosci il parlato dall’audio</strong> — STT a segmenti dall’audio originale.</li><li><strong>Usa i sottotitoli del video</strong> — YouTube/auto-CC → testo con tempi.</li><li><strong>Traduzione live</strong> nella lingua di destinazione (es. PL, EN, ES…).</li><li><strong>Narratore neurale</strong> (femminile / maschile) mixato con lo sfondo.</li><li><strong>Sottotitoli SRT</strong> + burn-in opzionale.</li><li><strong>Migliora audio:</strong> volume, bassi/alti, denoise, focus voce, bitrate.</li></ul><p class='feature-cta'>→ Colonna 2 · Narratore · Qualità audio · Sottotitoli</p>",
    "feat.pc.cardTitle": "4 · Il tuo PC",
    "feat.pc.cardDesc": "Agente locale · privacy · senza coda",
    "feat.pc.title": "4 · Il tuo PC",
    "feat.pc.html":
      "<p><strong>UI nel cloud, calcolo sulla tua macchina</strong> — senza coda condivisa e senza conservare per sempre i video sul server.</p><ul><li><strong>Agente PC</strong> — un file ⬇ PC, installazione dal cloud, job sul tuo computer.</li><li><strong>Chip PC · ON</strong> — sai quando l’agente è collegato al tuo account.</li><li><strong>Privacy</strong> — file di lavoro in locale; risultati grandi sul disco (anteprima localhost), senza limite 500 MB cloud.</li><li><strong>Multi-utente</strong> — ognuno ha account, token e job propri.</li></ul><p class='feature-cta'>→ Studio · pulsante ⬇ PC · RUN-AGENT.bat</p>",
  },
  pt: {
    "feat.menuAria": "Principais recursos do ClipForge",
    "feat.close": "Fechar descrição",
    "feat.delogo.cardTitle": "1 · Imagem limpa",
    "feat.delogo.cardDesc": "Remover logos e marcas d’água",
    "feat.delogo.title": "1 · Imagem limpa",
    "feat.delogo.html":
      "<p><strong>Remova logos, marcas d’água e overlays</strong> — sem montagem manual no CapCut.</p><ul><li><strong>Seleção manual</strong> — desenhe retângulo(s) no frame onde está o logo.</li><li><strong>Auto (baixo)</strong> — correção rápida de watermarks típicos embaixo.</li><li><strong>Métodos:</strong> delogo (natural), barra preta (100% de cobertura), blur + cobertura maior.</li><li>Várias áreas — vários logos no mesmo vídeo.</li></ul><p class='feature-cta'>→ Coluna 1 · Opções de vídeo · “Remover logo / marca d’água”</p>",
    "feat.hd.cardTitle": "2 · Super HD / IA",
    "feat.hd.cardDesc": "HD rápido + Real-ESRGAN x4plus",
    "feat.hd.title": "2 · Super HD / IA",
    "feat.hd.html":
      "<p><strong>Eleve a qualidade para HD nítido</strong> — do FFmpeg rápido ao Real-ESRGAN forte.</p><ul><li><strong>HD rápido</strong> — scale + nitidez + denoise + cor (auto ou manual).</li><li><strong>IA Real-ESRGAN</strong> no seu PC (agente): modelos Anime/Video e <strong>Fotorreal x4plus</strong>.</li><li><strong>x4plus</strong> — melhor para pessoas/vídeo real; o modelo precisa estar no PC; mais lento que Anime/Video.</li><li><strong>Estilo e enquadramento:</strong> Cartoon, Cinematic, VHS, Noir, 9:16 Reels, 1:1, estabilizar, velocidade, máx 15/30/60 s.</li><li>Comparação <strong>ANTES / DEPOIS</strong> com dois players.</li></ul><p class='feature-cta'>→ Coluna 1 · Qualidade e resolução · Estilo e enquadramento</p>",
    "feat.voice.cardTitle": "3 · Narrador e legendas",
    "feat.voice.cardDesc": "STT · traduzir · TTS · SRT",
    "feat.voice.title": "3 · Narrador e legendas",
    "feat.voice.html":
      "<p><strong>Do áudio do vídeo você gera narrador e legendas prontas para publicar</strong> — em vários idiomas.</p><ul><li><strong>Reconhecer a fala do áudio</strong> — STT em segmentos do áudio original.</li><li><strong>Usar legendas do vídeo</strong> — YouTube/auto-CC → texto com tempo.</li><li><strong>Tradução ao vivo</strong> para o idioma de destino (ex. PL, EN, ES…).</li><li><strong>Narrador neural</strong> (feminino / masculino) misturado com o fundo.</li><li><strong>Legendas SRT</strong> + burn-in opcional.</li><li><strong>Melhoria de áudio:</strong> volume, graves/agudos, denoise, foco na voz, bitrate.</li></ul><p class='feature-cta'>→ Coluna 2 · Narrador · Qualidade de áudio · Legendas</p>",
    "feat.pc.cardTitle": "4 · Seu PC",
    "feat.pc.cardDesc": "Agente local · privacidade · sem fila",
    "feat.pc.title": "4 · Seu PC",
    "feat.pc.html":
      "<p><strong>UI na nuvem, processamento na sua máquina</strong> — sem fila compartilhada e sem guardar seus vídeos para sempre no servidor.</p><ul><li><strong>Agente PC</strong> — um arquivo ⬇ PC, instalação da nuvem, jobs no seu computador.</li><li><strong>Chip PC · ON</strong> — veja quando o agente está ligado à sua conta.</li><li><strong>Privacidade</strong> — arquivos de trabalho no local; resultados grandes no disco (prévia localhost), sem limite de 500 MB na nuvem.</li><li><strong>Multi-usuário</strong> — cada um tem conta, token e jobs próprios.</li></ul><p class='feature-cta'>→ Studio · botão ⬇ PC · RUN-AGENT.bat</p>",
  },
  ru: {
    "feat.menuAria": "Главные возможности ClipForge",
    "feat.close": "Закрыть описание",
    "feat.delogo.cardTitle": "1 · Чистая картинка",
    "feat.delogo.cardDesc": "Удаление логотипов и водяных знаков",
    "feat.delogo.title": "1 · Чистая картинка",
    "feat.delogo.html":
      "<p><strong>Удаление логотипов, водяных знаков и оверлеев</strong> — без ручного монтажа в CapCut.</p><ul><li><strong>Ручной выбор</strong> — нарисуйте прямоугольник(и) на кадре, где логотип.</li><li><strong>Авто (низ)</strong> — быстрый ретуш типичных нижних watermark.</li><li><strong>Методы:</strong> delogo (натурально), чёрная полоса (100 % скрытие), blur + сильнее закрыть.</li><li>Несколько областей — несколько лого на одном ролике.</li></ul><p class='feature-cta'>→ Колонка 1 · Опции видео · «Удалить лого / водяной знак»</p>",
    "feat.hd.cardTitle": "2 · Super HD / ИИ",
    "feat.hd.cardDesc": "Быстрый HD + Real-ESRGAN x4plus",
    "feat.hd.title": "2 · Super HD / ИИ",
    "feat.hd.html":
      "<p><strong>Поднимите качество до резкого HD</strong> — от быстрого FFmpeg до сильного Real-ESRGAN.</p><ul><li><strong>Быстрый HD</strong> — scale + резкость + denoise + цвет (авто или вручную).</li><li><strong>ИИ Real-ESRGAN</strong> на вашем ПК (агент): модели Anime/Video и <strong>Фотореал x4plus</strong>.</li><li><strong>x4plus</strong> — лучше для реальных людей/видео; модель должна быть на ПК; медленнее Anime/Video.</li><li><strong>Стиль и кадр:</strong> Cartoon, Cinematic, VHS, Noir, 9:16 Reels, 1:1, стабилизация, темп, макс 15/30/60 с.</li><li>Сравнение <strong>ДО / ПОСЛЕ</strong> двумя плеерами.</li></ul><p class='feature-cta'>→ Колонка 1 · Качество и разрешение · Стиль и кадр</p>",
    "feat.voice.cardTitle": "3 · Диктор и субтитры",
    "feat.voice.cardDesc": "STT · перевод · TTS · SRT",
    "feat.voice.title": "3 · Диктор и субтитры",
    "feat.voice.html":
      "<p><strong>Из аудио видео — диктор и субтитры к публикации</strong> — на многих языках.</p><ul><li><strong>Распознать речь из звука</strong> — STT сегментами из оригинального аудио.</li><li><strong>Взять субтитры из видео</strong> — YouTube/auto-CC → текст со временем.</li><li><strong>Перевод вживую</strong> на целевой язык (напр. PL, EN, ES…).</li><li><strong>Нейро-диктор</strong> (женский / мужской) в миксе с фоном.</li><li><strong>Субтитры SRT</strong> + опциональный burn-in.</li><li><strong>Улучшение звука:</strong> громкость, bass/treble, denoise, фокус на голос, битрейт.</li></ul><p class='feature-cta'>→ Колонка 2 · Диктор · Качество звука · Субтитры</p>",
    "feat.pc.cardTitle": "4 · Ваш ПК",
    "feat.pc.cardDesc": "Локальный агент · приватность · без очереди",
    "feat.pc.title": "4 · Ваш ПК",
    "feat.pc.html":
      "<p><strong>UI в облаке, расчёт у вас</strong> — без общей очереди и без вечного хранения роликов на сервере.</p><ul><li><strong>PC Agent</strong> — один файл ⬇ PC, установка из облака, job’ы на вашем компьютере.</li><li><strong>Чип PC · ON</strong> — видно, когда агент привязан к вашему аккаунту.</li><li><strong>Приватность</strong> — рабочие файлы локально; крупные результаты на диске (превью localhost), без лимита 500 МБ облака.</li><li><strong>Multi-user</strong> — у каждого свой аккаунт, токен и job’ы.</li></ul><p class='feature-cta'>→ Studio · кнопка ⬇ PC · RUN-AGENT.bat</p>",
  },
  zh: {
    "feat.menuAria": "ClipForge 主要功能",
    "feat.close": "关闭说明",
    "feat.delogo.cardTitle": "1 · 干净画面",
    "feat.delogo.cardDesc": "去除 logo 与水印",
    "feat.delogo.title": "1 · 干净画面",
    "feat.delogo.html":
      "<p><strong>去除 logo、水印与叠层</strong> — 无需在 CapCut 中手动剪辑。</p><ul><li><strong>手动框选</strong> — 在帧上画出 logo 所在矩形。</li><li><strong>自动（底部）</strong> — 快速处理常见底部水印。</li><li><strong>方法：</strong> delogo（自然）、黑条（100% 遮盖）、模糊 + 更强遮盖。</li><li>多区域 — 同一视频多个 logo。</li></ul><p class='feature-cta'>→ 第 1 列 · 视频选项 · “去除 logo / 水印”</p>",
    "feat.hd.cardTitle": "2 · 超级高清 / AI",
    "feat.hd.cardDesc": "快速高清 + Real-ESRGAN x4plus",
    "feat.hd.title": "2 · 超级高清 / AI",
    "feat.hd.html":
      "<p><strong>把画质拉到清晰高清</strong> — 从快速 FFmpeg 到强力 Real-ESRGAN。</p><ul><li><strong>快速高清</strong> — 缩放 + 锐化 + 降噪 + 色彩（自动或手动）。</li><li><strong>本机 AI Real-ESRGAN</strong>（代理）：Anime/Video 与 <strong>写实 x4plus</strong>。</li><li><strong>x4plus</strong> — 更适合真实人物/视频；模型需在 PC 上；比 Anime/Video 更慢。</li><li><strong>风格与构图：</strong> 卡通、电影感、VHS、Noir、9:16 Reels、1:1、防抖、速度、最长 15/30/60 秒。</li><li><strong>前后对比</strong> 双播放器结果预览。</li></ul><p class='feature-cta'>→ 第 1 列 · 质量与分辨率 · 风格与构图</p>",
    "feat.voice.cardTitle": "3 · 旁白与字幕",
    "feat.voice.cardDesc": "STT · 翻译 · TTS · SRT",
    "feat.voice.title": "3 · 旁白与字幕",
    "feat.voice.html":
      "<p><strong>从视频音频生成旁白与可发布字幕</strong> — 多语言。</p><ul><li><strong>从音频识别语音</strong> — 按段 STT 原音频。</li><li><strong>使用视频字幕</strong> — YouTube/自动字幕 → 带时间文本。</li><li><strong>实时翻译</strong> 到目标语言（如 PL、EN、ES…）。</li><li><strong>神经旁白</strong>（女声 / 男声）与背景混音。</li><li><strong>SRT 字幕</strong> + 可选烧录。</li><li><strong>音频增强：</strong> 音量、低音/高音、降噪、人声、码率。</li></ul><p class='feature-cta'>→ 第 2 列 · 旁白 · 音频质量 · 字幕</p>",
    "feat.pc.cardTitle": "4 · 你的电脑",
    "feat.pc.cardDesc": "本地代理 · 隐私 · 无排队",
    "feat.pc.title": "4 · 你的电脑",
    "feat.pc.html":
      "<p><strong>界面在云端，计算在你本机</strong> — 无共享队列，也不会永久把视频存在服务器。</p><ul><li><strong>PC 代理</strong> — 一个 ⬇ PC 文件，从云安装，任务在你电脑上跑。</li><li><strong>PC · ON 指示</strong> — 知道代理何时连到你的账户。</li><li><strong>隐私</strong> — 工作文件在本地；大结果在硬盘（localhost 预览），无 500 MB 云限制。</li><li><strong>多用户</strong> — 各自账户、令牌与任务。</li></ul><p class='feature-cta'>→ Studio · ⬇ PC 按钮 · RUN-AGENT.bat</p>",
  },
  ar: {
    "feat.menuAria": "أبرز ميزات ClipForge",
    "feat.close": "إغلاق الوصف",
    "feat.delogo.cardTitle": "1 · صورة نظيفة",
    "feat.delogo.cardDesc": "إزالة الشعارات والعلامات المائية",
    "feat.delogo.title": "1 · صورة نظيفة",
    "feat.delogo.html":
      "<p><strong>إزالة الشعارات والعلامات المائية والطبقات</strong> — دون مونتاج يدوي في CapCut.</p><ul><li><strong>اختيار يدوي</strong> — ارسم مستطيلًا/مستطيلات على الإطار حيث الشعار.</li><li><strong>تلقائي (أسفل)</strong> — إصلاح سريع لعلامات أسفل الإطار.</li><li><strong>الطرق:</strong> delogo (طبيعي)، شريط أسود (تغطية 100%)، ضبابية + تغطية أقوى.</li><li>مناطق متعددة — عدة شعارات في فيديو واحد.</li></ul><p class='feature-cta'>→ العمود 1 · خيارات الفيديو · «إزالة الشعار / العلامة المائية»</p>",
    "feat.hd.cardTitle": "2 · سوبر HD / ذكاء اصطناعي",
    "feat.hd.cardDesc": "HD سريع + Real-ESRGAN x4plus",
    "feat.hd.title": "2 · سوبر HD / ذكاء اصطناعي",
    "feat.hd.html":
      "<p><strong>ارفع الجودة إلى HD حاد</strong> — من FFmpeg السريع إلى Real-ESRGAN القوي.</p><ul><li><strong>HD سريع</strong> — تحجيم + حدة + تقليل ضوضاء + ألوان (تلقائي أو يدوي).</li><li><strong>Real-ESRGAN على جهازك</strong> (الوكيل): نماذج Anime/Video و<strong>واقعي x4plus</strong>.</li><li><strong>x4plus</strong> — أفضل للأشخاص/الفيديو الحقيقي؛ يجب أن يكون النموذج على الجهاز؛ أبطأ من Anime/Video.</li><li><strong>الأسلوب والإطار:</strong> كرتون، سينمائي، VHS، نوار، 9:16 Reels، 1:1، تثبيت، سرعة، حد أقصى 15/30/60 ث.</li><li>مقارنة <strong>قبل / بعد</strong> بمُشغّلين.</li></ul><p class='feature-cta'>→ العمود 1 · الجودة والدقة · أسلوب وإطار الفيديو</p>",
    "feat.voice.cardTitle": "3 · معلّق وترجمات",
    "feat.voice.cardDesc": "STT · ترجمة · TTS · SRT",
    "feat.voice.title": "3 · معلّق وترجمات",
    "feat.voice.html":
      "<p><strong>من صوت الفيديو: معلّق وترجمات جاهزة للنشر</strong> — بلغات كثيرة.</p><ul><li><strong>تعرّف على الكلام من الصوت</strong> — STT على مقاطع من الصوت الأصلي.</li><li><strong>خذ ترجمات الفيديو</strong> — يوتيوب/تلقائي → نص مع الوقت.</li><li><strong>ترجمة مباشرة</strong> إلى اللغة الهدف (مثل PL, EN, ES…).</li><li><strong>معلّق عصبي</strong> (أنثوي / ذكوري) ممزوج مع الخلفية.</li><li><strong>ترجمات SRT</strong> + حرق اختياري على الصورة.</li><li><strong>تحسين الصوت:</strong> مستوى، جهير/حدة، تقليل ضوضاء، تركيز على الصوت، معدل بت.</li></ul><p class='feature-cta'>→ العمود 2 · المعلّق · جودة الصوت · الترجمات</p>",
    "feat.pc.cardTitle": "4 · جهازك",
    "feat.pc.cardDesc": "وكيل محلي · خصوصية · بلا طابور",
    "feat.pc.title": "4 · جهازك",
    "feat.pc.html":
      "<p><strong>واجهة في السحابة، والحساب على جهازك</strong> — بلا طابور مشترك وبلا حفظ دائم لفيديوهاتك على الخادم.</p><ul><li><strong>وكيل PC</strong> — ملف واحد ⬇ PC، تثبيت من السحابة، مهام على حاسوبك.</li><li><strong>شريحة PC · ON</strong> — تعرف متى يتصل الوكيل بحسابك.</li><li><strong>الخصوصية</strong> — ملفات العمل محليًا؛ النتائج الكبيرة على القرص (معاينة localhost)، بلا حد 500 ميغابايت سحابي.</li><li><strong>متعدد المستخدمين</strong> — لكل حساب وتوكن ومهام خاصة.</li></ul><p class='feature-cta'>→ Studio · زر ⬇ PC · RUN-AGENT.bat</p>",
  },
  hi: {
    "feat.menuAria": "ClipForge की मुख्य सुविधाएँ",
    "feat.close": "विवरण बंद करें",
    "feat.delogo.cardTitle": "1 · साफ़ तस्वीर",
    "feat.delogo.cardDesc": "लोगो और वॉटरमार्क हटाएँ",
    "feat.delogo.title": "1 · साफ़ तस्वीर",
    "feat.delogo.html":
      "<p><strong>लोगो, वॉटरमार्क और ओवरले हटाएँ</strong> — CapCut में मैन्युअल संपादन के बिना।</p><ul><li><strong>मैन्युअल चयन</strong> — फ्रेम पर लोगो वाले आयत बनाएँ।</li><li><strong>ऑटो (नीचे)</strong> — नीचे के आम वॉटरमार्क का तेज़ सुधार।</li><li><strong>विधियाँ:</strong> delogo (प्राकृतिक), काली पट्टी (100% कवर), ब्लर + मज़बूत कवर।</li><li>कई क्षेत्र — एक वीडियो में कई लोगो।</li></ul><p class='feature-cta'>→ कॉलम 1 · वीडियो विकल्प · “लोगो / वॉटरमार्क हटाएँ”</p>",
    "feat.hd.cardTitle": "2 · सुपर HD / AI",
    "feat.hd.cardDesc": "तेज़ HD + Real-ESRGAN x4plus",
    "feat.hd.title": "2 · सुपर HD / AI",
    "feat.hd.html":
      "<p><strong>गुणवत्ता को तेज़ HD तक बढ़ाएँ</strong> — तेज़ FFmpeg से मज़बूत Real-ESRGAN तक।</p><ul><li><strong>तेज़ HD</strong> — स्केल + शार्पन + डेनॉइज़ + रंग (ऑटो या मैन्युअल)।</li><li><strong>AI Real-ESRGAN</strong> आपके PC पर (एजेंट): Anime/Video और <strong>फोटोरियल x4plus</strong>।</li><li><strong>x4plus</strong> — असली लोगों/वीडियो के लिए बेहतर; मॉडल PC पर होना चाहिए; Anime/Video से धीमा।</li><li><strong>स्टाइल और फ्रेम:</strong> Cartoon, Cinematic, VHS, Noir, 9:16 Reels, 1:1, स्थिरता, गति, अधिकतम 15/30/60 से।</li><li><strong>पहले / बाद</strong> दो प्लेयर से तुलना।</li></ul><p class='feature-cta'>→ कॉलम 1 · गुणवत्ता और रिज़ॉल्यूशन · स्टाइल और फ्रेम</p>",
    "feat.voice.cardTitle": "3 · नैरेटर और कैप्शन",
    "feat.voice.cardDesc": "STT · अनुवाद · TTS · SRT",
    "feat.voice.title": "3 · नैरेटर और कैप्शन",
    "feat.voice.html":
      "<p><strong>वीडियो ऑडियो से नैरेटर और प्रकाशन-तैयार कैप्शन</strong> — कई भाषाओं में।</p><ul><li><strong>ऑडियो से बोलचाल पहचानें</strong> — मूल ऑडियो के सेगमेंट में STT।</li><li><strong>वीडियो कैप्शन लें</strong> — YouTube/ऑटो-CC → समय के साथ टेक्स्ट।</li><li><strong>लाइव अनुवाद</strong> लक्ष्य भाषा में (जैसे PL, EN, ES…)।</li><li><strong>न्यूरल नैरेटर</strong> (महिला / पुरुष) पृष्ठभूमि के साथ मिक्स।</li><li><strong>SRT कैप्शन</strong> + वैकल्पिक बर्न-इन।</li><li><strong>ऑडियो सुधार:</strong> वॉल्यूम, बास/ट्रेबल, डेनॉइज़, आवाज़ फोकस, बिटरेट।</li></ul><p class='feature-cta'>→ कॉलम 2 · नैरेटर · ऑडियो गुणवत्ता · कैप्शन</p>",
    "feat.pc.cardTitle": "4 · आपका PC",
    "feat.pc.cardDesc": "लोकल एजेंट · गोपनीयता · बिना कतार",
    "feat.pc.title": "4 · आपका PC",
    "feat.pc.html":
      "<p><strong>UI क्लाउड में, गणना आपके मशीन पर</strong> — साझा कतार नहीं, सर्वर पर वीडियो हमेशा नहीं रहते।</p><ul><li><strong>PC एजेंट</strong> — एक ⬇ PC फ़ाइल, क्लाउड से इंस्टॉल, जॉब आपके कंप्यूटर पर।</li><li><strong>PC · ON चिप</strong> — जानें कब एजेंट आपके खाते से जुड़ा है।</li><li><strong>गोपनीयता</strong> — वर्क फ़ाइलें लोकल; बड़े परिणाम डिस्क पर (localhost पूर्वावलोकन), 500 MB क्लाउड सीमा नहीं।</li><li><strong>मल्टी-यूज़र</strong> — हर किसी का खाता, टोकन और जॉब।</li></ul><p class='feature-cta'>→ Studio · ⬇ PC बटन · RUN-AGENT.bat</p>",
  },
};

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
}
function save(name, obj) {
  fs.writeFileSync(
    path.join(dir, name),
    JSON.stringify(obj, null, 2) + "\n",
    "utf8"
  );
}

// pl + en
save("pl.json", { ...load("pl.json"), ...base.pl });
save("en.json", { ...load("en.json"), ...base.en });

// others
const enFull = { ...base.en };
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  if (f === "pl.json" || f === "en.json") continue;
  const code = f.replace(/\.json$/, "");
  const j = load(f);
  Object.assign(j, enFull, more[code] || {});
  save(f, j);
  console.log("feat →", code);
}

// verify
const must = Object.keys(base.pl);
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const j = load(f);
  const miss = must.filter((k) => !j[k]);
  console.log(f, miss.length ? "MISS " + miss.join(",") : "OK");
}
