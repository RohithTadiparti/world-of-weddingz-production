import { describe, expect, it } from 'vitest';
import { parseBiodata, readBiodata, spreadsheetRowsToText } from './biodata-import';

describe('biodata document extraction', () => {
  it('maps the supplied biodata without using relatives education or occupation', () => {
    const fields = parseBiodata(`BIO - DATA
Name: Narendranath Reddy Ganampet
DOB: 03.05.1999 (Monday) (26)
TOB: 1:11 AM (Midnight)
POB: Hanumakonda, Telangana
Star: Anuradha
Rasi: Vruchika
Caste: Reddy
Sub-Caste: Motati
Height: 5 feet 10 inches
Colour: Brown
Education: Schooling: Johnson Grammar School, I.C.S.E, Habsiguda/Nacharam
(2014)
Intermediate: Narayana College, Nagole, Bi.P.C
Undergrad: M.B;B.S (KAMSRC 2016, LB Nagar)
Postgrad: Residency training in Internal medicine, North Carolina, USA
Family:
Father: Mahesh Reddy Ganampet
Occupation: Business (Real Estate)
Mother: Sunitha Reddy Ganampet
Occupation: Business
Sibling: Nikethan Reddy Ganampet (24)
Education: Undergrad: Osmania University (Computer Science)
Postgrad: Masters in computer science, UTA, TX, USA`);
    expect(fields).toEqual({
      displayName: 'Narendranath Reddy Ganampet', firstName: 'Narendranath', lastName: 'Reddy Ganampet',
      dateOfBirth: '1999-05-03', timeOfBirth: '1:11 AM', placeOfBirth: 'Hanumakonda, Telangana',
      star: 'Anuradha', rashi: 'Vruchika', caste: 'Reddy', subCaste: 'Motati', heightCm: '178',
      complexion: 'Brown', highestQualification: 'Residency training in Internal medicine',
      fatherName: 'Mahesh Reddy Ganampet', fatherProfession: 'Business (Real Estate)',
      motherName: 'Sunitha Reddy Ganampet', motherProfession: 'Business',
    });
  });

  it('handles spaces before colons, bullets, and explicit relative occupation labels', () => {
    const fields = parseBiodata(`BIO - DATA
Name : Narendranath Reddy Ganampet
DOB : 03.05.1999 (Monday) (26)
TOB: 1:11 AM (Midnight)
POB: Hanumakonda, Telangana
Star: Anuradha
Rasi : Vruchika
Caste: Reddy
Sub-Caste: Motati
Height: 5 feet 10 inches
Colour: Brown
Education:
- Schooling: Johnson Grammar School, I.C.S.E, Habsiguda/Nacharam
- Intermediate: Narayana College, Nagole, Bi.P.C
- Undergrad: M.B;B.S (KAMSRC 2016, LB Nagar)
- Postgrad: Residency training in Internal medicine, North Carolina, USA
Family:
Father: Mahesh Reddy Ganampet
Father occupation: Business (Real Estate)
Mother: Sunitha Reddy Ganampet
Mother occupation: Business
Sibling: Nikethan Reddy Ganampet (24)`);
    expect(fields).toEqual({
      displayName: 'Narendranath Reddy Ganampet', firstName: 'Narendranath', lastName: 'Reddy Ganampet',
      dateOfBirth: '1999-05-03', timeOfBirth: '1:11 AM', placeOfBirth: 'Hanumakonda, Telangana',
      star: 'Anuradha', rashi: 'Vruchika', caste: 'Reddy', subCaste: 'Motati', heightCm: '178',
      complexion: 'Brown', highestQualification: 'Residency training in Internal medicine',
      fatherName: 'Mahesh Reddy Ganampet', fatherProfession: 'Business (Real Estate)',
      motherName: 'Sunitha Reddy Ganampet', motherProfession: 'Business',
    });
  });

  it('selects the highest education level regardless of ordering, with latest entry winning ties', () => {
    expect(parseBiodata(`Postgrad: First qualification
Schooling: Example School
Intermediate: Example College
Undergrad: B.Tech
Postgrad: Most recent qualification, Example City`)).toEqual({ highestQualification: 'Most recent qualification' });
    expect(parseBiodata('Education: N/A\nUndergrad: B.Tech\nPostgrad: Unknown'))
      .toEqual({ highestQualification: 'B.Tech' });
  });

  it('normalises dotted birth abbreviations and rejects invalid annotated dates and times', () => {
    expect(parseBiodata('D.O.B.: 03.05.1999\nT.O.B.: 1:11 am (Midnight)\nP.O.B.: Hanumakonda, Telangana'))
      .toEqual({ dateOfBirth: '1999-05-03', timeOfBirth: '1:11 AM', placeOfBirth: 'Hanumakonda, Telangana' });
    expect(parseBiodata('DOB: 31.02.1999 (Monday)\nTOB: 13:70 AM')).toEqual({});
  });

  it('maps the complete example and all supported sections', () => {
    expect(parseBiodata(`Name: Rahul Kumar
DOB: 15/08/1998
Gender: Male
Religion: Hindu
Caste: Kamma
Sub-caste: Example
Mother Tongue: Telugu
Education: B.Tech
Occupation: Software Engineer
Employer: Example Ltd
Course: Computer Science
Native Place: Hyderabad
City: Hyderabad
Father: Ramesh
Mother: Lakshmi
Family Type: Nuclear
Height: 175 cm
Mobile: 9876543210
Address: Hyderabad
Rashi: Mesha
Star: Ashwini
Padam: 2
Gothram: Example
Kuja Dosham: No
Time of Birth: 06:30
Place of Birth: Hyderabad`)).toEqual({
      displayName: 'Rahul Kumar', firstName: 'Rahul', lastName: 'Kumar',
      dateOfBirth: '1998-08-15', gender: 'male', religion: 'Hindu', caste: 'Kamma',
      subCaste: 'Example', motherTongue: 'Telugu', highestQualification: 'B.Tech',
      profession: 'Software Engineer', company: 'Example Ltd', course: 'Computer Science',
      nativePlace: 'Hyderabad', city: 'Hyderabad', fatherName: 'Ramesh', motherName: 'Lakshmi',
      familyType: 'Nuclear', heightCm: '175', contactPhone: '9876543210',
      communicationAddress: 'Hyderabad', rashi: 'Mesha', star: 'Ashwini', padam: '2',
      gothram: 'Example', kujaDosham: 'No', timeOfBirth: '06:30', placeOfBirth: 'Hyderabad',
    });
  });

  it('handles columns, line-separated labels, apostrophes and feet/inches', () => {
    expect(parseBiodata(`Name: Rahul Kumar   Gender: Male
Education:
B.Tech
Father's Name: Ramesh
Height: 5 ft 9 in`)).toMatchObject({ displayName: 'Rahul Kumar', gender: 'male',
      highestQualification: 'B.Tech', fatherName: 'Ramesh', heightCm: '175' });
  });

  it('handles biodata label variants, written dates, continued values and sibling counts', () => {
    expect(parseBiodata(`Full Name - Anjali Devi
D.O.B:
5th April 1998
Height: 5' 2"
Father's Name: Srinivas
Father's Occupation: Farmer
Mother's Name: Padma
Mother's Occupation: Teacher
Rasi: Kanya
Nakshatram: Hasta
Siblings: 1 Brother, 2 Sisters`)).toMatchObject({
      displayName: 'Anjali Devi', firstName: 'Anjali', lastName: 'Devi',
      dateOfBirth: '1998-04-05', heightCm: '157', fatherName: 'Srinivas',
      fatherProfession: 'Farmer', motherName: 'Padma', motherProfession: 'Teacher',
      rashi: 'Kanya', star: 'Hasta', brothers: '1', sisters: '2',
    });
  });

  it('leaves missing and malformed values empty without guessing from other fields', () => {
    expect(parseBiodata(`Native Place: Hyderabad
DOB: 31/02/1998
Mobile: 123
Height: tall
Brothers: several
Email: invalid
Gender: unknown
Religion: N/A`)).toEqual({ nativePlace: 'Hyderabad' });
  });

  it('rejects unsupported files before trying OCR or uploading', async () => {
    const bytes = new TextEncoder().encode('not an image');
    const file = { name: 'not-a-biodata.txt', size: bytes.length, arrayBuffer: async () => bytes.buffer } as File;
    await expect(readBiodata(file)).rejects.toThrow('PDF, Word document, Excel file');
  });

  it('turns two-column and header-row spreadsheets into explicit biodata labels', () => {
    expect(spreadsheetRowsToText([
      ['Field', 'Value'], ['Name', 'Anjali Devi'], ['Height', '5 ft 2 in'],
    ])).toBe('Name: Anjali Devi\nHeight: 5 ft 2 in');
    expect(spreadsheetRowsToText([
      ['Name', 'DOB', 'Caste'], ['Rahul Kumar', '15/08/1998', 'Kamma'],
    ])).toBe('Name: Rahul Kumar\nDOB: 15/08/1998\nCaste: Kamma');
  });
});
