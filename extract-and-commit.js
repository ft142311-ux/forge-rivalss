#!/usr/bin/env node

/**
 * Скрипт для распаковки project_1a076871d6b.zip и коммита содержимого
 * Использование: node extract-and-commit.js
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ZIP_FILE = 'project_1a076871d6b.zip';
const EXTRACT_DIR = './project-extracted';

console.log('📦 Начинаем распаковку архива...\n');

try {
  // Проверяем наличие ZIP файла
  if (!fs.existsSync(ZIP_FILE)) {
    console.error(`❌ Ошибка: Файл ${ZIP_FILE} не найден!`);
    process.exit(1);
  }

  // Создаем новый ZIP объект
  const zip = new AdmZip(ZIP_FILE);
  
  // Получаем список файлов
  const zipEntries = zip.getEntries();
  console.log(`📂 Найдено файлов/папок: ${zipEntries.length}\n`);

  // Показываем структуру
  console.log('📋 Структура архива:');
  zipEntries.forEach((entry) => {
    if (entry.isDirectory) {
      console.log(`📁 ${entry.entryName}`);
    } else {
      console.log(`📄 ${entry.entryName} (${entry.header.size} bytes)`);
    }
  });

  // Создаем директорию для распаковки
  if (!fs.existsSync(EXTRACT_DIR)) {
    fs.mkdirSync(EXTRACT_DIR, { recursive: true });
    console.log(`\n✅ Создана директория: ${EXTRACT_DIR}`);
  }

  // Распаковываем архив
  zip.extractAllTo(EXTRACT_DIR, true);
  console.log(`\n✅ Архив успешно распакован в: ${EXTRACT_DIR}\n`);

  // Выводим что распаковалось
  const extracted = fs.readdirSync(EXTRACT_DIR, { recursive: true });
  console.log(`📊 Всего файлов распаковано: ${extracted.length}`);
  console.log('\n🎉 Успешно!\n');
  console.log('Следующие шаги:');
  console.log('1. Проверьте содержимое в папке project-extracted/');
  console.log('2. Переместите нужные файлы в корень проекта');
  console.log('3. Удалите папку project-extracted/ после проверки');

} catch (error) {
  console.error('❌ Ошибка при распаковке:', error.message);
  process.exit(1);
}
