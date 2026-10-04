import { UnprocessableEntityException } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { VendorsService } from '../vendors/vendors.service';
import { CompleteOptions, DEFAULT_TEMPERATURE, OpenAiProvider } from './ai.provider';
import { AiService, EXTRACTION_TEMPERATURE, extractedHeightCm, parseExtraction } from './ai.service';

function serviceWith(reply: string) {
  const provider = { complete: jest.fn<Promise<string>, [string, CompleteOptions?]>(async () => reply) };
  const service = new AiService({} as MatchmakingService, {} as VendorsService, provider);
  return { service, provider };
}

describe('AiService.extractBiodata', () => {
  it('reads with a low temperature and asks for JSON, leaving the assistant alone', async () => {
    const { service, provider } = serviceWith('{"firstName":"Bhavana"}');
    await expect(service.extractBiodata('https://signed.example/a.jpg')).resolves.toEqual({
      firstName: 'Bhavana',
    });
    expect(provider.complete).toHaveBeenCalledWith(expect.any(String), {
      imageUrl: 'https://signed.example/a.jpg',
      temperature: EXTRACTION_TEMPERATURE,
      json: true,
    });

    await service.assistant('How many guests?');
    expect(provider.complete).toHaveBeenLastCalledWith('How many guests?');
  });

  it.each([
    ['prose', 'I can help you plan your wedding.'],
    ['an empty object', '{}'],
    ['an object with nothing in it', '{"firstName":null,"family":{"father":{"name":""}}}'],
    ['a list', '[{"firstName":"Bhavana"}]'],
  ])('answers 422 for %s rather than an empty success', async (_what, reply) => {
    const { service } = serviceWith(reply);
    await expect(service.extractBiodata('https://signed.example/a.jpg')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('reads a fenced reply', () => {
    expect(parseExtraction('```json\n{"caste":"Kamma"}\n```')).toEqual({ caste: 'Kamma' });
  });
});

describe('OpenAiProvider temperature', () => {
  const cfg = {
    ai: { apiKey: 'test-key', model: 'test-model', baseUrl: 'https://model.example', provider: 'openai' },
  } as unknown as AppConfigService;
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'answer' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

  it('keeps the conversational default for an ordinary answer', async () => {
    await new OpenAiProvider(cfg).complete('hello');
    expect(sent().temperature).toBe(DEFAULT_TEMPERATURE);
    expect(sent().response_format).toBeUndefined();
  });

  it('uses the temperature and JSON mode a caller asks for', async () => {
    await new OpenAiProvider(cfg).complete('read this', {
      imageUrl: 'https://signed.example/a.jpg',
      temperature: 0.1,
      json: true,
    });
    expect(sent().temperature).toBe(0.1);
    expect(sent().response_format).toEqual({ type: 'json_object' });
    expect(sent().messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://signed.example/a.jpg' },
    });
  });
});

describe('extractedHeightCm', () => {
  it.each([
    [168, 168],
    ['167.6', 168],
    ['170 cm', 170],
    ["5'6\"", 168],
    ['5 ft 6 in', 168],
    ['5 feet', 152],
    ['5.6', 168],
    ['5.10 ft', 178],
  ])('reads %p as %p cm', (value, cm) => {
    expect(extractedHeightCm(value)).toBe(cm);
  });

  it.each([null, '', 'tall', '5.13', 40, '300 cm'])('drops %p', (value) => {
    expect(extractedHeightCm(value)).toBeNull();
  });
});
