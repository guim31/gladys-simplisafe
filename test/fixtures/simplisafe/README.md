# SimpliSafe API fixtures

Answers of the SimpliSafe cloud API and WebSocket, copied from the tests of
[bachya/simplisafe-python](https://github.com/bachya/simplisafe-python)
(`tests/fixtures`, release 2026.09.0), the library behind the Home Assistant
`simplisafe` integration. They keep the shape of the real answers, with the
made-up values of that project (account 12345, "1234 Main Street", Atlantis).

Renamed with dashes. Changes, for this public repository:

- `ws-motion-event-data.json`: the camera uuid, its serial and the AWS account
  of the media addresses are replaced by made-up values;
- `ws-message-subscribed-data.json`: the user namespace is the user id of
  `auth-check-response.json` (12345).

The WebSocket files hold the `data` part of a message: the tests wrap it in the
CloudEvents envelope simplisafe-python uses (`tests/conftest.py`).

simplisafe-python is distributed under the MIT License:

> The MIT License (MIT)
>
> Copyright (c) 2016 William Scanlon, 2018-2024 Aaron Bach
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
