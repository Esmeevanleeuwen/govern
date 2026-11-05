#!/usr/bin/env python3
"""Whiteboard HTTP contracts in a confirmed isolated loopback database.

--fixture-transcriber sends synthetic PCM to an explicitly chosen TEST provider.
These tests prove transport/persistence/provenance, never speech/model quality.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import http.cookiejar
import io
import json
import math
import os
import struct
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
from auth_http import ensure_authenticated


def uid():
    return str(uuid.uuid4())


class Client:
    def __init__(self, base, database, schema, authenticated=True):
        self.base = base.rstrip('/')
        self.scope = dict(connection='postgres', database=database, schema=schema)
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf = ensure_authenticated(self.opener, self.base)['csrf'] if authenticated else ''

    def call(self, action, body=None, *, params=None, scope=None, headers=None, csrf=True, multipart=None):
        query = {**(self.scope if scope is None else scope), 'action': action, **(params or {})}
        request_headers = {'Accept': 'application/json', 'Accept-Language': 'nl'}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode()
            request_headers['Content-Type'] = 'application/json'
        if multipart is not None:
            data, request_headers['Content-Type'] = multipart
        if data is not None and csrf:
            request_headers['X-CSRF-Token'] = self.csrf
        request_headers.update(headers or {})
        request = urllib.request.Request(self.base + '/api.php?' + urllib.parse.urlencode(query), data=data, headers=request_headers)
        try:
            response = self.opener.open(request, timeout=35)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())


def audio(frequency=440):
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b''.join(struct.pack('<h', int(5000 * math.sin(2 * math.pi * frequency * i / 16000))) for i in range(96000)))
    return output.getvalue()


def form(fields, wav):
    boundary = 'govern-studio-test-' + uuid.uuid4().hex
    parts = []
    for key, value in fields.items():
        parts.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' + str(value) + '\r\n').encode())
    parts.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="chunk.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode())
    parts.extend([wav, ('\r\n--' + boundary + '--\r\n').encode()])
    return b''.join(parts), 'multipart/form-data; boundary=' + boundary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default=os.environ.get('BASE_URL', 'http://127.0.0.1:8080'))
    parser.add_argument('--confirm-database', required=True)
    parser.add_argument('--schema', default='brainstorm')
    parser.add_argument('--fixture-transcriber', action='store_true')
    args = parser.parse_args()
    if urllib.parse.urlparse(args.base_url).hostname not in {'localhost', '127.0.0.1', '::1'}:
        parser.error('Use only an isolated loopback stack.')
    if args.confirm_database not in {'govern_studio_test', 'govern_pg'}:
        parser.error('Confirm an isolated govern_studio_test or govern_pg database.')
    count = 0

    def check(condition, message):
        nonlocal count
        if not condition:
            raise AssertionError(message)
        count += 1

    def ok(result, message):
        status, payload = result
        check(status in {200, 201} and payload.get('ok') is True, message + ' (' + str(status) + ': ' + str(payload.get('error_code', '')) + ')')
        return payload['data']

    def rejects(result, status, code, message):
        actual, payload = result
        check(actual == status and payload.get('ok') is False and payload.get('error_code') == code,
              message + ' (' + str(actual) + ': ' + str(payload.get('error_code', '')) + ')')

    anon = Client(args.base_url, args.confirm_database, args.schema, False)
    rejects(anon.call('studio-bootstrap'), 401, 'auth_required', 'Studio data requires login.')
    first = Client(args.base_url, args.confirm_database, args.schema)
    second = Client(args.base_url, args.confirm_database, args.schema)
    boot = ok(first.call('studio-bootstrap'), 'Authenticated bootstrap.')
    check(boot['enabled'] is True and boot['ready'] is True, 'Isolated Studio is enabled and migrated.')
    check(boot['scope_key'] == 'postgres:' + args.confirm_database + ':' + args.schema, 'Bootstrap captures the complete PostgreSQL scope.')
    generation = boot['generation']
    check(isinstance(generation, str) and len(generation) >= 16, 'A schema-generation token is available.')
    check(not {'url', 'api_key'} & boot['transcription'].keys(), 'Public provider metadata contains no address or credential.')
    rejects(first.call('studio-bootstrap', scope=dict(connection='postgres', database=args.confirm_database, schema='public')),
            403, 'studio_config_invalid', 'Another schema cannot become Studio storage.')
    rejects(first.call('studio-bootstrap', scope=dict(connection='postgres', database='different_database', schema=args.schema)),
            403, 'database_not_available', 'A caller cannot select another database.')
    rejects(first.call('studio-bootstrap', scope=dict(database=args.confirm_database)), 403, 'studio_config_invalid', 'MariaDB never receives Studio writes.')
    board_id = uid()
    create = dict(id=board_id, title="HTTP test <idea> 'SQL' — " + board_id[:8], operation_id=uid(), generation=generation)
    rejects(first.call('studio-create-board', create, csrf=False), 403, 'csrf_invalid', 'Board writes require CSRF.')
    rejects(first.call('studio-create-board', create, headers={'Origin': 'https://other.invalid'}), 403, 'origin_not_allowed', 'Same-origin checks remain active.')
    rejects(first.call('studio-create-board'), 405, 'post_required', 'A GET cannot create a board.')
    created = ok(first.call('studio-create-board', create), 'Create a board.')
    check(created['id'] == board_id and created['title'] == create['title'], 'Identity and literal board title survive storage.')
    check(ok(first.call('studio-create-board', create), 'Replay board creation.') == created, 'Creation replay returns the original result.')
    rejects(first.call('studio-create-board', {**create, 'title': 'different'}), 409, 'studio_operation_conflict', 'An operation ID binds its payload.')

    def snapshot(client=first, board=board_id):
        return ok(client.call('studio-board', params={'board': board}), 'Read a persisted board.')

    initial = snapshot()
    check(initial['nodes'] == [] and initial['edges'] == [], 'New boards contain no fabricated sample data.')
    node_id, other_id, edge_id = uid(), uid(), uid()
    text = "Notitie <script>literal</script> ' ; --"
    node = dict(id=node_id, kind='note', text=text, x=35.5, y=-20, width=240, height=160, data={})
    other = dict(id=other_id, kind='idea', text='Klantomgeving', x=370, y=180, width=240, height=160, data={})
    packet = dict(board_id=board_id, base_revision=initial['board']['revision'], generation=generation, operation_id=uid(), changes=[
        dict(type='put-node', node=node), dict(type='put-node', node=other),
        dict(type='put-edge', edge=dict(id=edge_id, from_node_id=node_id, to_node_id=other_id, label='leidt tot'))])
    committed = ok(first.call('studio-mutate', packet), 'Persist cards and their explicit edge atomically.')
    check(committed['revision'] > initial['board']['revision'], 'A commit advances the revision.')
    check(ok(first.call('studio-mutate', packet), 'Replay a committed mutation.') == committed, 'Replay does not duplicate nodes or revisions.')
    altered = {**packet, 'changes': [dict(type='put-node', node={**node, 'text': 'different payload'})]}
    rejects(first.call('studio-mutate', altered), 409, 'studio_operation_conflict', 'Mutation replay cannot change its payload.')
    after = snapshot(second)
    check({item['id'] for item in after['nodes']} == {node_id, other_id} and len(after['edges']) == 1, 'An independent client observes cards and edge.')
    stored = next(item for item in after['nodes'] if item['id'] == node_id)
    check(stored['text'] == text and float(stored['x']) == 35.5, 'Literal note text and fractional coordinates survive an independent read.')
    stale = {**altered, 'operation_id': uid()}
    rejects(second.call('studio-mutate', stale), 409, 'studio_revision_conflict', 'Stale clients cannot overwrite newer work.')
    rejects(second.call('studio-mutate', {**stale, 'base_revision': after['board']['revision'], 'generation': 'old-generation'}),
            409, 'studio_generation_conflict', 'An old restore generation cannot write.')
    packets = [{**stale, 'base_revision': after['board']['revision'], 'operation_id': uid(),
                'changes': [dict(type='put-node', node={**node, 'text': value})]} for value in ['Concurrent A', 'Concurrent B']]
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda pair: pair[0].call('studio-mutate', pair[1]), zip([first, second], packets)))
    check(sorted(status for status, _ in outcomes) == [200, 409], 'Concurrent edits produce one commit and one explicit conflict.')
    winning = snapshot()
    check(next(item for item in winning['nodes'] if item['id'] == node_id)['text'] in {'Concurrent A', 'Concurrent B'}, 'The concurrent winner persists.')

    recording_id = uid()
    start = dict(id=recording_id, board_id=board_id, generation=generation, operation_id=uid())
    ok(first.call('studio-start-recording', start), 'Start a board-scoped recording.')
    ok(first.call('studio-start-recording', start), 'A recording-start replay is safe.')
    fields = dict(board_id=board_id, recording_id=recording_id, generation=generation, sequence=0, start_ms=0, end_ms=6000, operation_id=uid())
    rejects(first.call('studio-audio', multipart=form(fields, b'not a WAV even with a wav filename')), 422, 'studio_audio_invalid', 'Audio validation inspects file bytes.')
    wav = audio()
    rejects(first.call('studio-audio', multipart=form(fields, wav), csrf=False), 403, 'csrf_invalid', 'Multipart audio requires CSRF.')
    rejects(first.call('studio-audio', multipart=form({**fields, 'end_ms': 12000}, wav)), 422, 'studio_audio_invalid', 'Claimed timing must match PCM duration.')
    if args.fixture_transcriber:
        result = ok(first.call('studio-audio', multipart=form(fields, wav)), 'Send PCM through the selected provider fixture.')
        segment = result['segment']
        check(segment['recording_id'] == recording_id and segment['sequence'] == 0, 'A transcript retains recording/chunk identity.')
        check(segment['start_ms'] == 0 and segment['end_ms'] == 6000, 'A transcript retains its source timestamps.')
        check(segment['text'] and segment['node_id'], 'Finalized speech creates a sourced note.')
        duplicate = ok(first.call('studio-audio', multipart=form(fields, wav)), 'Retry the processed audio chunk.')
        check(duplicate['segment']['id'] == segment['id'] and duplicate['duplicate'] is True, 'Audio replay returns the original segment.')
        rejects(first.call('studio-audio', multipart=form(fields, audio(880))), 409, 'studio_segment_conflict', 'Chunk identity cannot bind different audio.')
        rejects(first.call('studio-audio', multipart=form({**fields, 'sequence': 1, 'start_ms': 6000, 'end_ms': 12000}, wav)),
                409, 'studio_operation_conflict', 'A completed audio operation ID cannot be reused for a new chunk.')
        speech = snapshot(second)
        source_note = next(item for item in speech['nodes'] if item['id'] == segment['node_id'])
        check(source_note['source_segment_id'] == segment['id'], 'A note references its original transcript.')
        edit = {key: source_note[key] for key in ['id', 'kind', 'text', 'x', 'y', 'width', 'height', 'data']}
        edit['text'] = 'Handmatig verfijnd idee'
        ok(second.call('studio-mutate', dict(board_id=board_id, base_revision=speech['board']['revision'], generation=generation,
            operation_id=uid(), changes=[dict(type='put-node', node=edit)])), 'Manually refine a generated note.')
        edited = snapshot()
        check(next(item for item in edited['segments'] if item['id'] == segment['id'])['text'] == segment['text'], 'Manual refinement preserves original speech.')
        check(len([item for item in edited['nodes'] if item.get('source_segment_id') == segment['id']]) == 1, 'Replay preserves one sourced note.')
    stop = dict(id=recording_id, board_id=board_id, generation=generation)
    ok(first.call('studio-stop-recording', stop), 'Stop a recording.')
    ok(first.call('studio-stop-recording', stop), 'A repeated stop is safe.')
    if args.fixture_transcriber:
        rejects(first.call('studio-audio', multipart=form({**fields, 'sequence': 1, 'start_ms': 6000, 'end_ms': 12000, 'operation_id': uid()}, wav)),
                409, 'studio_recording_stopped', 'Stopped recordings reject new speech.')
    catalog = ok(first.call('schema'), 'Read the same schema through Govern.')
    names = {table['name'] for table in catalog['tables']}
    check({'studio_boards', 'studio_notes', 'studio_transcripts'} <= names, 'Govern discovers views of the same whiteboard data.')
    check(not any(name.startswith('_govern_studio_') for name in names), 'Internal tables stay outside the ordinary row editor.')
    browse = ok(first.call('browse', params=dict(table='studio_notes', page=1, per_page=100)), 'Browse whiteboard notes in Govern.')
    check(browse['total'] >= 2, 'Govern reads notes written by the separate whiteboard API.')
    print('PASS: ' + str(count) + ' Studio HTTP/auth/CSRF/scope/concurrency/persistence checks' +
          (' with synthetic audio/provider fixtures.' if args.fixture_transcriber else '; provider audio checks skipped.'))


if __name__ == '__main__':
    main()
