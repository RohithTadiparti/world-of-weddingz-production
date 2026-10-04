function degreeRank(text: string): number {
  const lower = text.toLowerCase();
  if (/\b(?:ph\.?d|doctorate|post[\s-]?doc|fellowship)\b/i.test(lower)) return 5;
  if (/\b(?:master|masters|m\.?s|m\.?tech|m\.?b\.?a|m\.?c\.?a|m\.?d|m\.?e|m\.?com|post[\s-]?grad|residency)\b/i.test(lower)) return 4;
  if (/\b(?:bachelor|bachelors|b\.?tech|b\.?e|b\.?sc|b\.?c\.?a|b\.?com|b\.?a|m\.?b;?b\.?s|under[\s-]?grad|graduate|graduation|degree)\b/i.test(lower)) return 3;
  if (/\b(?:inter|intermediate|diploma|10\+2|puc|higher secondary)\b/i.test(lower)) return 2;
  if (/\b(?:school|schooling|ssc|10th|icse|cbse)\b/i.test(lower)) return 1;
  return 0;
}

function cleanQualificationValue(text: string): string {
  let cleaned = text.replace(/^[-•*]\s*/, '').trim();
  cleaned = cleaned.replace(/^(?:post[\s-]?grad(?:uate)?|under[\s-]?grad(?:uate)?|graduation|intermediate|schooling)\s*[:\uFF1A]\s*/i, '');
  cleaned = cleaned.split(',')[0].trim();
  cleaned = cleaned.replace(/\s*\([^)]*(\)|$)/g, '').trim();
  return cleaned;
}

/** Only explicitly labelled values are mapped; unknown/missing values stay empty. */
export function parseBiodata(text: string): Record<string, string> {
  const aliases: Record<string, string> = {
    name: 'displayName', 'full name': 'displayName', 'date of birth': 'dateOfBirth', dob: 'dateOfBirth',
    mobile: 'contactPhone', phone: 'contactPhone', 'mobile number': 'contactPhone', email: 'contactEmail',
    gender: 'gender', city: 'city', location: 'city', religion: 'religion', caste: 'caste',
    'sub caste': 'subCaste', subcaste: 'subCaste', 'sub-caste': 'subCaste',
    'religion/caste': 'caste', 'religion / caste': 'caste', 'religion and caste': 'caste',
    'mother tongue': 'motherTongue', education: 'highestQualification',
    qualification: 'highestQualification', occupation: 'profession', profession: 'profession',
    'first name': 'firstName', 'last name': 'lastName', 'native place': 'nativePlace',
    surname: 'lastName', 'birth date': 'dateOfBirth', sex: 'gender',
    'contact number': 'contactPhone', 'phone number': 'contactPhone', 'contact email': 'contactEmail',
    height: 'heightCm', 'height cm': 'heightCm', complexion: 'complexion', colour: 'complexion', color: 'complexion',
    address: 'communicationAddress', 'communication address': 'communicationAddress',
    'alternate mobile': 'alternateMobile', 'native state': 'nativeState',
    'native country': 'nativeCountry', 'native district': 'nativeDistrict',
    denomination: 'denomination', 'marital status': 'maritalStatus',
    father: 'fatherName', 'father name': 'fatherName', 'fathers name': 'fatherName',
    mother: 'motherName', 'mother name': 'motherName', 'mothers name': 'motherName',
    'father occupation': 'fatherProfession', 'father profession': 'fatherProfession',
    'fathers occupation': 'fatherProfession', 'fathers profession': 'fatherProfession',
    'mother occupation': 'motherProfession', 'mother profession': 'motherProfession',
    'mothers occupation': 'motherProfession', 'mothers profession': 'motherProfession',
    'family type': 'familyType', 'family status': 'familyStatus',
    brothers: 'brothers', sisters: 'sisters', siblings: 'siblings',
    'highest qualification': 'highestQualification', course: 'course',
    institution: 'institution', college: 'institution', university: 'institution', 'college place': 'collegePlace',
    employer: 'company', company: 'company', designation: 'designation',
    'occupation status': 'occupationStatus', 'work location': 'workLocation',
    'annual income': 'annualIncome', salary: 'salary',
    rashi: 'rashi', rasi: 'rashi', star: 'star', nakshatra: 'star', nakshatram: 'star',
    padam: 'padam', pada: 'padam', gothram: 'gothram', gotra: 'gothram', gothra: 'gothram',
    'kuja dosham': 'kujaDosham', manglik: 'kujaDosham',
    'time of birth': 'timeOfBirth', 'birth time': 'timeOfBirth', tob: 'timeOfBirth',
    'place of birth': 'placeOfBirth', 'birth place': 'placeOfBirth', pob: 'placeOfBirth', 'about me': 'bio',
  };
  const educationLevels: Record<string, number> = {
    schooling: 1, intermediate: 2, undergrad: 3, undergraduate: 3,
    'under graduate': 3, graduation: 3, postgrad: 4, postgraduate: 4, 'post graduate': 4,
    doctorate: 5, phd: 5,
  };
  const result: Record<string, string> = {};
  const labelNames = [
    ...Object.keys(aliases), ...Object.keys(educationLevels),
    'family', 'sibling', 'family details', 'personal details', 'educational details',
    'sister', 'brother', 'sister name', 'brother name',
  ];
  const labelsPattern = labelNames
    .sort((a, b) => b.length - a.length)
    .map(label => label.replace(/[/]/g, '[/]').replace(/ /g, '[ .-]+'))
    .join('|');

  // OCR commonly separates every character in D.O.B. Preserve the familiar
  // abbreviation before looking for labels, so it maps just like "DOB".
  text = text.replace(/\b([dtp])\s*\.?\s*o\s*\.?\s*b\.?\s*(?=[:\uFF1A;\-\u2013\u2014\s])/gi,
    (_, initial: string) => `${initial.toUpperCase()}OB`);
  text = text.replace(/([a-z])['’]s(?=\s+(?:name|occupation|profession))/gi, '$1s');

  // Split multi-column lines like "Name: Rahul Kumar   Gender: Male"
  text = text.replace(
    new RegExp(`([ \\t]{2,}|\\|)(?=(${labelsPattern})[ \\t]*[:\\uFF1A])`, 'gi'),
    '\n'
  );

  // If a colon has its value on the next line (and that next line does not have a colon), join them
  text = text.replace(/[:\uFF1A][ \t]*\r?\n[ \t]*(?=[^\r\n:]+(?:\r?\n|$))/g, ': ');

  let inFamily = false;
  let familyMember: 'father' | 'mother' | 'sibling' | undefined;
  let educationRank = 0;
  let inQualificationSection = false;

  const labelLineRegex = new RegExp(
    `^\\s*(?:[-•*]\\s*)?(${labelsPattern})\\s*(?:\\([^)]*\\)\\s*)?(?:[:\\uFF1A;]+|\\s*[-–—]+\\s*|\\s+)(.*)$`,
    'i'
  );

  for (const line of text.split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for section headers
    if (/^\s*(?:personal details|educational? details|biodata|bio\s*[-–—]?\s*data)\s*[:\uFF1A]?\s*$/i.test(trimmed)) {
      inFamily = false;
      inQualificationSection = false;
      continue;
    }
    if (/^\s*(?:family details|family)\s*[:\uFF1A]?\s*$/i.test(trimmed)) {
      inFamily = true;
      familyMember = undefined;
      inQualificationSection = false;
      continue;
    }

    const match = trimmed.match(labelLineRegex);
    if (!match) {
      // Continuation line (e.g. multi-line education under Qualification:)
      if (inQualificationSection && !inFamily) {
        const rank = degreeRank(trimmed);
        if (rank > 0 && rank >= educationRank) {
          educationRank = rank;
          result.highestQualification = cleanQualificationValue(trimmed);
        }
      }
      continue;
    }

    const rawLabel = match[1].trim().toLowerCase().replace(/[.'’()]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ');
    const label = rawLabel;
    let key = aliases[label] || aliases[label.replace(/\//g, ' ')];
    let value = match[2].trim().replace(/\s*\|$/, '').trim();

    // Qualification/Education section tracking
    const rank = educationLevels[label] || degreeRank(label);
    if (rank || key === 'highestQualification') {
      if (!inFamily) {
        inQualificationSection = true;
        const valRank = degreeRank(value) || rank || 0;
        if (valRank >= educationRank && value && !/^(?:n\/?a|not specified|unknown|[-—]+)$/i.test(value)) {
          educationRank = valRank;
          result.highestQualification = cleanQualificationValue(value);
        }
        continue;
      } else {
        continue;
      }
    } else {
      inQualificationSection = false;
    }

    // Family tracking
    if (key === 'fatherName') {
      inFamily = true;
      familyMember = 'father';
    } else if (key === 'motherName') {
      inFamily = true;
      familyMember = 'mother';
    } else if (label === 'sibling' || label === 'sister' || label === 'brother' || label === 'sister name' || label === 'brother name' || key === 'siblings' || key === 'brothers' || key === 'sisters') {
      inFamily = true;
      familyMember = 'sibling';
    }

    if (!value || /^(?:n\/?a|not specified|unknown|[-—]+)$/i.test(value)) continue;

    if (key === 'profession' && inFamily) {
      if (familyMember !== 'father' && familyMember !== 'mother') continue;
      key = familyMember === 'father' ? 'fatherProfession' : 'motherProfession';
    }

    if (!key || result[key]) continue;

    if (key === 'dateOfBirth') {
      const normalised = parseDateOfBirth(value);
      if (!normalised) continue;
      value = normalised;
    }
    if (key === 'timeOfBirth') {
      const time = value.match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)?(?:\s*\([^()]*\))*$/i);
      if (!time || Number(time[1]) > (time[3] ? 12 : 23) || (time[3] && Number(time[1]) === 0)) continue;
      value = `${time[1]}:${time[2]}${time[3] ? ` ${time[3].toUpperCase()}` : ''}`;
    }
    if (key === 'contactPhone' || key === 'alternateMobile') {
      value = value.replace(/[\s()-]/g, '').replace(/^\+91/, '');
      if (!/^[6-9]\d{9}$/.test(value)) continue;
    }
    if (key === 'gender') {
      value = value.toLowerCase();
      if (!['male', 'female', 'other'].includes(value)) continue;
    }
    if (key === 'contactEmail' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
    if (key === 'heightCm') {
      const cm = value.match(/^(\d{2,3}(?:\.\d+)?)\s*(?:cm|cms|centimeters|centimetres)?$/i);
      const feet = value.match(/^(\d)\s*(?:ft|feet|')\s*(\d{1,2})?\s*(?:in|inches|")?$/i);
      const height = cm ? Number(cm[1]) : feet && Number(feet[2] || 0) < 12
        ? (Number(feet[1]) * 12 + Number(feet[2] || 0)) * 2.54 : NaN;
      if (!Number.isFinite(height) || height < 50 || height > 250) continue;
      value = String(Math.round(height));
    }
    if (key === 'siblings') {
      const brothers = value.match(/\b(\d{1,2})\s+brothers?\b/i);
      const sisters = value.match(/\b(\d{1,2})\s+sisters?\b/i);
      if (brothers) result.brothers = brothers[1];
      if (sisters) result.sisters = sisters[1];
      continue;
    }
    if (key === 'brothers' || key === 'sisters') {
      if (!/^\d{1,2}$/.test(value)) continue;
    }
    result[key] = value;
  }
  if (result.displayName && !result.firstName && !result.lastName) {
    const [first, ...rest] = result.displayName.split(/\s+/);
    result.firstName = first;
    if (rest.length) result.lastName = rest.join(' ');
  }
  if (!result.displayName && (result.firstName || result.lastName)) {
    result.displayName = [result.firstName, result.lastName].filter(Boolean).join(' ');
  }
  return result;
}

/**
 * Turn the common two-column Excel layout ("Field" / "Value") into the
 * labelled text the biodata parser already understands. If the first row is a
 * set of field names, use the next populated row as its values instead.
 */
export function spreadsheetRowsToText(rows: unknown[][]): string {
  const value = (cell: unknown) => String(cell ?? '').trim();
  const nonEmpty = rows
    .map((row) => row.map(value))
    .filter((row) => row.some(Boolean));
  if (!nonEmpty.length) return '';

  const first = nonEmpty[0];
  const fieldValueHeader = /^(field|label|detail|particular|attribute)$/i.test(first[0] ?? '')
    && /^(value|answer|details?|information)$/i.test(first[1] ?? '');
  if (fieldValueHeader) {
    return nonEmpty.slice(1)
      .filter((row) => row[0] && row[1])
      .map((row) => `${row[0]}: ${row.slice(1).filter(Boolean).join(' ')}`)
      .join('\n');
  }

  // A worksheet exported from a form commonly has its labels across row one.
  // Pair each heading with the first completed response row below it.
  const response = nonEmpty.slice(1).find((row) => row.some(Boolean));
  if (response && first.length > 2) {
    return first
      .map((heading, index) => heading && response[index] ? `${heading}: ${response[index]}` : '')
      .filter(Boolean)
      .join('\n');
  }

  return nonEmpty
    .filter((row) => row[0] && row[1])
    .map((row) => `${row[0]}: ${row.slice(1).filter(Boolean).join(' ')}`)
    .join('\n');
}

function bufferFor(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

type BiodataDocumentKind = 'pdf' | 'image' | 'docx' | 'spreadsheet';

function documentKind(file: File, bytes: Uint8Array): BiodataDocumentKind | undefined {
  const name = String(file.name ?? '').toLowerCase();
  const pdf = new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
  const png = bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (pdf) return 'pdf';
  if (png || jpeg) return 'image';
  if (/\.docx$/i.test(name)) return 'docx';
  if (/\.(?:xlsx|xls|csv)$/i.test(name)) return 'spreadsheet';
  return undefined;
}

/** Converts only unambiguous, explicitly labelled Indian biodata dates to ISO. */
function parseDateOfBirth(value: string): string | undefined {
  value = value.replace(/(?:\s*\([^()]*\))+\s*$/, '').trim();
  const numeric = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  let day: number;
  let month: number;
  let year: number;
  if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    year = Number(numeric[3]);
  } else {
    const months = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
    ];
    const dayFirst = value.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s*,?\s+(\d{4})$/i);
    const monthFirst = value.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(\d{4})$/i);
    const parts = dayFirst ?? monthFirst;
    if (!parts) return undefined;
    const monthName = (dayFirst ? parts[2] : parts[1]).toLowerCase();
    month = months.indexOf(monthName) + 1;
    day = Number(dayFirst ? parts[1] : parts[2]);
    year = Number(parts[3]);
  }
  if (!month || !day || !year) return undefined;
  const iso = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : undefined;
}

export async function readBiodata(file: File): Promise<Record<string, string>> {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a file under 10 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = documentKind(file, bytes);
  if (!kind) throw new Error('Choose a PDF, Word document, Excel file, JPG or PNG biodata.');
  let worker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | undefined;
  const ocr = async (source: File | HTMLCanvasElement) => {
    // All OCR runtime files are served with the application. Tesseract's defaults
    // point at a public CDN, which would otherwise make uploads depend on it.
    const ocrBase = `${import.meta.env.BASE_URL}ocr`;
    worker ??= await (await import('tesseract.js')).createWorker('eng', undefined, {
      workerPath: `${ocrBase}/worker.min.js`,
      corePath: `${ocrBase}/core/tesseract-core.wasm.js`,
      langPath: `${ocrBase}/lang`,
    });
    const { data } = await worker.recognize(source);
    if (data.confidence < 60) throw new Error('This scan is not clear enough to import reliably. Use a clearer image or enter the details manually.');
    return data.text;
  };
  let text = '';
  try {
    if (kind === 'docx') {
      const mammoth = await import('mammoth');
      text = (await mammoth.extractRawText({ arrayBuffer: bufferFor(bytes) })).value;
    } else if (kind === 'spreadsheet') {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(bytes, { type: 'array', cellText: true, cellDates: false });
      text = workbook.SheetNames
        .map((name) => spreadsheetRowsToText(XLSX.utils.sheet_to_json(workbook.Sheets[name], {
          header: 1,
          defval: '',
          raw: false,
        }) as unknown[][]))
        .filter(Boolean)
        .join('\n');
    } else if (kind === 'pdf') {
      const lib = await import('pdfjs-dist');
      lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
      const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      try {
        if (doc.numPages > 10) throw new Error('Choose a biodata PDF with at most 10 pages.');
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          let pageText = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
          if (!Object.keys(parseBiodata(pageText)).length) {
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(base.width, base.height)) });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width; canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('This browser cannot render the PDF for text recognition.');
            await page.render({ canvas, canvasContext: context, viewport }).promise;
            pageText = await ocr(canvas);
            canvas.width = canvas.height = 0;
          }
          text += pageText + '\n';
          page.cleanup();
        }
      } finally { await doc.destroy(); }
    } else text = await ocr(file);
  } finally { await worker?.terminate(); }
  const fields = parseBiodata(text);
  if (!Object.keys(fields).length) throw new Error('Unable to extract the details from this document. Please enter the details manually.');
  return fields;
}
