import { ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter correlation', () => {
  it('echoes the request id and keeps query strings out of the envelope', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const setHeader = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, setHeader }),
        getRequest: () => ({
          id: 'request-42',
          method: 'GET',
          path: '/reset',
          url: '/reset?token=secret',
          headers: {},
        }),
      }),
    } as unknown as ArgumentsHost;
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    new AllExceptionsFilter().catch(new HttpException('No', 400), host);

    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', 'request-42');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'request-42', path: '/reset' }),
    );
    expect(JSON.stringify(json.mock.calls)).not.toContain('secret');
  });
});
