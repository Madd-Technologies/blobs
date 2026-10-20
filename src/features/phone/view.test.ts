import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Call, Errand } from '../../lib/hermes/phone.ts'
import {
  addNumber,
  approveEdits,
  callingErrand,
  errandsForChat,
  barLine,
  callLine,
  callLines,
  canApprove,
  clock,
  compare,
  duringCall,
  formatNumber,
  gateLine,
  headline,
  hoursLabel,
  inMotion,
  modeLine,
  NO_CHOICES,
  openQuestion,
  phoneNeeds,
  placeErrands,
  quietNote,
  requestLine,
  resultsLine,
  spokenOpening,
  theyAsked,
  toggle,
  transcriptLines,
  yourAnswers,
} from './view.ts'

const call = (over: Partial<Call> = {}): Call => ({
  id: 'c_1',
  index: 0,
  name: 'Bayside Septic Service',
  number: '+12025550141',
  status: 'waiting',
  answered_by: '',
  started: null,
  ended: null,
  outcome: null,
  transcript: [],
  question: null,
  answers: [],
  hangup: false,
  error: '',
  hold: false,
  ...over,
})

const errand = (over: Partial<Errand> = {}): Errand => ({
  id: 'e_1',
  profile: 'harbor',
  session_id: 's_1',
  created: 1_000,
  status: 'pending',
  brief: {
    title: 'Septic pumping quotes',
    mode: 'quote',
    goal: 'Get a price for pumping a 1,000 gallon tank.',
    opening: '',
    facts: [
      { label: 'Tank size', value: 'About 1,000 gallons', estimate: true, only_if_asked: false },
      { label: 'Service address', value: '12 Elm Road', estimate: false, only_if_asked: true },
    ],
    questions: ['How much for a pump-out?'],
    record: [
      { key: 'price', label: 'Price' },
      { key: 'soonest', label: 'Soonest date' },
    ],
    accept: '',
    notes: '',
    calls: [
      { name: 'Bayside Septic Service', number: '+12025550141', source: 'their site', why: 'Closest' },
      { name: 'Clearwater Pumping', number: '+12025550142', source: 'a map listing', why: 'Good reviews' },
    ],
  },
  flags: [{ fact: 1, label: 'Service address', why: 'an address' }],
  ticked: [],
  decided: null,
  calls: [],
  ...over,
})

describe('clock and numbers', () => {
  it('writes m:ss, h:mm:ss past an hour, and never below zero', () => {
    assert.equal(clock(134), '2:14')
    assert.equal(clock(3_725), '1:02:05')
    assert.equal(clock(-5), '0:00')
  })

  it('writes US numbers as people do and leaves others alone', () => {
    assert.equal(formatNumber('+12025550141'), '(202) 555-0141')
    assert.equal(formatNumber('2025550141'), '(202) 555-0141')
    assert.equal(formatNumber('+442079460123'), '+442079460123')
  })
})

describe('the request card', () => {
  it('says the fixed disclosure first, then the bot’s own words or the title', () => {
    assert.deepEqual(spokenOpening({ title: 'Septic pumping quotes', opening: '' }, 'Alex', true), {
      fixed: 'Hi, this is an AI assistant calling for Alex. This call is transcribed.',
      own: 'I’m calling about septic pumping quotes.',
    })
    assert.equal(spokenOpening({ title: 'X', opening: 'I’d like a quote.' }, 'Alex', false).fixed, 'Hi, this is an AI assistant calling for Alex.')
    assert.equal(spokenOpening({ title: 'X', opening: ' I’d like a quote. ' }, 'Alex', false).own, 'I’d like a quote.')
  })

  it('says what each mode may do', () => {
    assert.equal(modeLine({ mode: 'quote', accept: '' }), 'Quotes only · never books or agrees to a price')
    assert.equal(modeLine({ mode: 'book', accept: 'a table for two, 7 to 8 PM' }), 'May book: a table for two, 7 to 8 PM · never agrees to a price')
    assert.equal(modeLine({ mode: 'ask', accept: '' }), 'Asks or passes on a message · never books')
  })

  it('holds Approve until each flag is ticked or struck and someone is left to call', () => {
    const e = errand()

    assert.equal(canApprove(e, NO_CHOICES), false)
    assert.equal(canApprove(e, { ...NO_CHOICES, ticked: [1] }), true)
    assert.equal(canApprove(e, { ...NO_CHOICES, struckFacts: [1] }), true)
    assert.equal(canApprove(e, { ...NO_CHOICES, ticked: [1], struckCalls: [0, 1] }), false)
    assert.equal(canApprove({ ...e, status: 'approved' }, { ...NO_CHOICES, ticked: [1] }), false)
  })

  it('sends a tick only for a flagged fact that is kept', () => {
    assert.deepEqual(approveEdits(errand(), { ticked: [1, 0], struckFacts: [], struckCalls: [1] }), { ticked: [1], remove_facts: [], remove_calls: [1] })
    assert.deepEqual(approveEdits(errand(), { ticked: [1], struckFacts: [1], struckCalls: [] }), { ticked: [], remove_facts: [1], remove_calls: [] })
  })

  it('toggles an index in and out, in order', () => {
    assert.deepEqual(toggle([2], 0), [0, 2])
    assert.deepEqual(toggle([0, 2], 2), [0])
  })

  it('says what is in the way, or what you struck', () => {
    assert.deepEqual(gateLine(errand(), NO_CHOICES), { needsYou: true, text: 'Tick or strike the service address to approve.' })
    assert.deepEqual(gateLine(errand(), { ticked: [1], struckFacts: [], struckCalls: [1] }), { needsYou: false, text: 'Clearwater Pumping won’t be called.' })
    assert.equal(gateLine(errand(), { ticked: [1], struckFacts: [], struckCalls: [0, 1] })?.text, 'Every call is struck. Keep one, or decline.')
    assert.equal(gateLine(errand(), { ...NO_CHOICES, ticked: [1] }), null)
  })

  it('counts the calls in the server’s words', () => {
    assert.equal(requestLine(errand()), '2 calls wait for your OK: Septic pumping quotes')
  })
})

describe('a call’s line', () => {
  it('marks the first waiting call next while another is on the line', () => {
    const e = errand({ status: 'running', calls: [call({ status: 'live', started: 100 }), call({ id: 'c_2', status: 'waiting' }), call({ id: 'c_3', status: 'waiting' })] })

    assert.deepEqual(
      callLines(e, 234).map(({ line }) => line.status),
      ['live 2:14', 'next', 'waiting'],
    )
  })

  it('shows hold, a question with its seconds left, and what a call came to', () => {
    assert.equal(callLine(call({ status: 'live', started: 0, hold: true }), 220).status, 'on hold 3:40')
    assert.equal(callLine(call({ status: 'live', started: 0, question: { text: 'How deep?', asked: 100, answer: null } }), 112).status, 'asks you · 0:48')
    assert.equal(callLine(call({ status: 'done', started: 0, ended: 292, outcome: { status: 'quoted' } }), 999).status, 'quoted · 4:52')
    assert.equal(callLine(call({ status: 'done', outcome: { status: 'no_answer', notes: 'Left a voicemail.' } }), 0).icon, 'voicemail')
    assert.equal(callLine(call({ status: 'done', outcome: { status: 'call_back', dont_call_again: true } }), 0).status, 'asked not to be called again')
    assert.equal(callLine(call({ status: 'done', hangup: true, outcome: { status: 'done', notes: 'Hung up from the app.' } }), 0).status, 'you hung up')
    assert.equal(callLine(call({ status: 'skipped', error: 'Not on the test numbers list.' }), 0).status, 'skipped: not a test number')
  })

  it('holds a question for 60 seconds at most, and none once answered or off the line', () => {
    const asked = { text: 'How deep?', asked: 100, answer: null }

    assert.equal(openQuestion(call({ status: 'live', question: asked }), 90)?.left, 60)
    assert.equal(openQuestion(call({ status: 'live', question: asked }), 200)?.left, 0)
    assert.equal(openQuestion(call({ status: 'live', question: { ...asked, answer: 'A foot' } }), 110), null)
    assert.equal(openQuestion(call({ status: 'done', question: asked }), 110), null)
  })

  it('puts the call’s place on the tray', () => {
    const live = call({ id: 'c_1', status: 'live', started: 0 })

    assert.equal(barLine({ calls: [live, call({ id: 'c_2' }), call({ id: 'c_3' })] }, live, 134), 'Live 2:14 · call 1 of 3')
    assert.equal(barLine({ calls: [live] }, live, 134), 'Live 2:14')
  })
})

describe('results', () => {
  const done = errand({
    status: 'done',
    finished: 5_000,
    calls: [
      call({ status: 'done', outcome: { status: 'quoted', price: '$325', soonest: 'Thursday' } }),
      call({ id: 'c_2', name: 'Clearwater Pumping', status: 'done', outcome: { status: 'quoted', price: '$290' } }),
      call({ id: 'c_3', name: 'Ridge Line Sanitation', status: 'done', outcome: { status: 'call_back', they_asked: 'Send photos of the lid.' } }),
    ],
  })

  it('sums up what the calls came to', () => {
    assert.equal(headline(done), '2 quotes, 1 call back')
    assert.equal(headline(errand({ calls: [call({ status: 'failed' }), call({ status: 'waiting' })] })), '1 couldn’t be placed')
    assert.equal(headline(errand({ calls: [call({ status: 'done', hangup: true, outcome: { status: 'call_back', notes: 'Hung up from the app.' } }), call({ id: 'c_2', status: 'cancelled' })] })), '1 hung up, 1 not called')
  })

  it('lines the answers up by field, with a dash for none', () => {
    assert.deepEqual(compare(done).rows, [
      { label: 'Price', values: ['$325', '$290', '—'] },
      { label: 'Soonest date', values: ['Thursday', '—', '—'] },
    ])
  })

  it('lists what calls asked of you', () => {
    assert.deepEqual(
      theyAsked(done).map(({ call: c, text }) => [c.id, text]),
      [['c_3', 'Send photos of the lid.']],
    )
  })
})

describe('the transcript', () => {
  it('says the voice’s own notes plainly', () => {
    assert.equal(quietNote('[pressed 1]', 'Alex'), 'Pressed 1')
    assert.equal(quietNote('[asked Alex: How deep is the lid?]', 'Alex'), 'Asked you: How deep is the lid?')
    assert.equal(quietNote('[Alex answered: About a foot.]', 'Alex'), 'You answered: About a foot.')
    assert.equal(quietNote('[Alex’s answer held back: it can’t go on a call]', 'Alex'), 'Your answer was held back: it can’t go on a call')
    assert.equal(quietNote('Hello there.', 'Alex'), null)
  })

  it('names who spoke and when', () => {
    const lines = transcriptLines(
      call({
        transcript: [
          { who: 'assistant', text: 'Hi, this is an AI assistant calling for Alex.', t: 0 },
          { who: 'them', text: 'Sure, go ahead.', t: 4 },
          { who: 'assistant', text: '[pressed 2]', t: 9 },
        ],
      }),
      'Alex',
    )

    assert.deepEqual(
      lines.map(line => [line.kind, line.who, line.at]),
      [
        ['assistant', 'Assistant', '0:00'],
        ['them', 'Bayside Septic', '0:04'],
        ['quiet', '', '0:09'],
      ],
    )
  })
})

describe('what waits on you', () => {
  it('lists requests oldest first, live questions, and finished errands that asked you something', () => {
    const now = 10_000
    const asking = errand({ id: 'e_2', status: 'running', calls: [call({ status: 'live', question: { text: 'How deep?', asked: now - 10, answer: null } })] })
    const asked = errand({ id: 'e_3', status: 'done', finished: now - 100, calls: [call({ status: 'done', outcome: { status: 'call_back', they_asked: 'Send photos.' } })] })
    const needs = phoneNeeds([errand({ id: 'e_1', created: 900 }), errand({ id: 'e_0', created: 800 }), asking, asked], [], now)

    assert.deepEqual(needs.requests.map(e => e.id), ['e_0', 'e_1'])
    assert.deepEqual(needs.questions.map(q => q.errand.id), ['e_2'])
    assert.deepEqual(needs.asked.map(e => e.id), ['e_3'])
    assert.deepEqual(phoneNeeds([asked], ['e_3'], now).asked, [])
    assert.deepEqual(phoneNeeds([asked], [], now + 8 * 86_400).asked, [])
  })
})

describe('settings', () => {
  it('writes calling hours', () => {
    assert.equal(hoursLabel([8, 21]), '8 AM – 9 PM')
    assert.equal(hoursLabel([0, 24]), '12 AM – midnight')
    assert.equal(hoursLabel([12, 13]), '12 PM – 1 PM')
  })

  it('adds a number once, whatever its formatting', () => {
    assert.deepEqual(addNumber(['+12025550141'], '(202) 555-0141'), ['+12025550141'])
    assert.deepEqual(addNumber([], ' 202-555-0142 '), ['202-555-0142'])
    assert.equal(addNumber([], '12'), null)
  })
})

describe('placeErrands', () => {
  it('puts each errand at the end of the turn it was made in, and new ones at the end', () => {
    const items = [
      { id: 'you-1', start: true, ts: 1_000_000 },
      { id: 'reply-1', start: false, ts: 1_500_000 },
      { id: 'day', start: true, ts: undefined },
      { id: 'you-2', start: true, ts: 3_000_000 },
      { id: 'reply-2', start: false, ts: 3_100_000 },
    ]
    const out = placeErrands(items, [{ id: 'late', created: 4_000 }, { id: 'mid', created: 1_200 }], item => (item.start ? { ts: item.ts } : null))

    assert.deepEqual(
      out.map(entry => entry.id),
      ['you-1', 'reply-1', 'errand-mid', 'day', 'you-2', 'reply-2', 'errand-late'],
    )
  })
})

describe('errandsForChat', () => {
  it('draws an errand in the chat it was made in, and one with no chat in the main chat', () => {
    const list = [errand({ id: 'a', session_id: 's_main' }), errand({ id: 'b', session_id: 's_side' }), errand({ id: 'c', session_id: '' }), errand({ id: 'd', profile: 'juniper', session_id: 's_main' })]

    assert.deepEqual(errandsForChat(list, 'harbor', ['s_main', null], true).map(e => e.id), ['a', 'c'])
    assert.deepEqual(errandsForChat(list, 'harbor', ['s_side'], false).map(e => e.id), ['b'])
  })

  it('finds the errand with a call on the line', () => {
    const calling = errand({ id: 'r', status: 'running', calls: [call({ status: 'done' }), call({ id: 'c_2', status: 'ringing' })] })

    assert.equal(callingErrand([errand(), calling])?.id, 'r')
    assert.equal(callingErrand([errand({ status: 'running', calls: [call({ status: 'waiting' })] })]), undefined)
  })

  it('shows an answer you just sent before the call service has read it, once', () => {
    const asked = { text: 'Any trees over the roof?', asked: 100, answer: 'Yes, two oaks.' }

    assert.deepEqual(yourAnswers(call({ answers: [{ question: 'Two stories?', answer: 'Yes.', asked: 40 }], question: asked })).map(a => a.answer), ['Yes.', 'Yes, two oaks.'])
    assert.equal(yourAnswers(call({ answers: [{ question: asked.text, answer: asked.answer, asked: 100 }], question: asked })).length, 1)
    assert.deepEqual(yourAnswers(call({ answers: [{ question: 'Gate code?', answer: null, asked: 10 }], question: { ...asked, answer: null } })), [])
  })

  it('keeps a stopped errand moving until its last call is off the line', () => {
    assert.equal(inMotion(errand({ status: 'cancelled', calls: [call({ status: 'live', hangup: true }), call({ id: 'c_2', status: 'cancelled' })] })), true)
    assert.equal(inMotion(errand({ status: 'cancelled', calls: [call({ status: 'done' }), call({ id: 'c_2', status: 'cancelled' })] })), false)
    assert.equal(inMotion(errand({ status: 'approved', calls: [call({ status: 'waiting' })] })), true)
    assert.equal(inMotion(errand({ status: 'pending' })), false)
  })
})

describe('a call’s report', () => {
  it('sums up the errand in time spent and what was agreed', () => {
    const calls = [call({ status: 'done', started: 0, ended: 292, outcome: { status: 'quoted' } }), call({ id: 'c_2', status: 'done', started: 400, ended: 770, outcome: { status: 'quoted' } }), call({ id: 'c_3', status: 'failed' })]

    assert.equal(resultsLine({ calls }), '3 calls, 11 minutes in all. Nothing was agreed.')
    assert.equal(resultsLine({ calls: [call({ status: 'done', started: 0, ended: 30, outcome: { status: 'booked' } })] }), '1 call, 1 minute in all. A booking was made.')
  })

  it('lists your answers, what is still open and what they asked of you', () => {
    const rows = duringCall({
      started: 100,
      answers: [{ question: 'Is the lid exposed?', answer: 'Buried, a foot down.', asked: 165 }, { question: 'Gate code?', answer: null }],
      outcome: { status: 'quoted', open_questions: 'Whether the county wants an inspection.' },
    })

    assert.deepEqual(rows, [
      { label: 'They asked · you answered at 1:05', text: '“Is the lid exposed?” “Buried, a foot down.”' },
      { label: 'They asked · no answer in time', text: '“Gate code?”' },
      { label: 'Still open', text: 'Whether the county wants an inspection.' },
      { label: 'They asked you to', text: 'Nothing', quiet: true },
    ])
  })
})
