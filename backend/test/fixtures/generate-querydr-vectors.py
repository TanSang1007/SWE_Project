"""Offline P00 reference oracle. Python stdlib only; never imports app code.

Synthetic crypto consistency, NOT actual VNPAY response compatibility evidence.
Run from repository root: python backend/test/fixtures/generate-querydr-vectors.py
"""
import hashlib
import hmac
import json
from pathlib import Path

SECRET = 'synthetic-b2a-querydr-reference-only'
FIELDS = ['ResponseId', 'Command', 'ResponseCode', 'Message', 'TmnCode', 'TxnRef',
          'Amount', 'BankCode', 'PayDate', 'TransactionNo', 'TransactionType',
          'TransactionStatus', 'OrderInfo', 'PromotionCode', 'PromotionAmount']
FIELDS = ['vnp_' + k for k in FIELDS]
BASE = dict(zip(FIELDS, ['response001', 'querydr', '00', 'Query successful',
            'TEST0001', '0123456789abcdef0123456789abcdef', '8500000', 'NCB',
            '20261017100000', '000123456', '01', '00', 'Thanh toan BrewLite', '123', '1000']))
optional = ['vnp_Command', 'vnp_PayDate', 'vnp_PromotionCode', 'vnp_PromotionAmount']
vectors = []


def add(name, fields=None, result='SUCCEEDED', transform=None, canonical_override=None):
    p = dict(BASE if fields is None else fields)
    canonical = '|'.join(p.get(k, '') for k in FIELDS)
    signed = canonical if canonical_override is None else canonical_override
    digest = hmac.new(SECRET.encode(), signed.encode(), hashlib.sha512).hexdigest()
    p['vnp_SecureHash'] = digest
    raw = json.dumps(p, ensure_ascii=False, separators=(',', ':'))
    if transform:
        raw = transform(raw)
    vectors.append(dict(name=name, raw=raw, canonical=canonical,
                        signedCanonical=signed, expectedHmac=digest, result=result))


add('full')
for key in optional:
    add('absent_' + key, {k: v for k, v in BASE.items() if k != key})
add('absent_all_optional', {k: v for k, v in BASE.items() if k not in optional})
add('empty_optional', {**BASE, **dict.fromkeys(optional, '')})
add('unicode', {**BASE, 'vnp_Message': 'Truy vấn thành công', 'vnp_OrderInfo': 'Thanh toán cà phê'})
add('wrong_order', result='REJECT', canonical_override='|'.join(BASE[k] for k in reversed(FIELDS)))
absent = {k: v for k, v in BASE.items() if k not in optional}
add('dropped_empty_segments', absent, 'REJECT', canonical_override='|'.join(absent[k] for k in FIELDS if k in absent))
add('tampered_amount', result='REJECT', transform=lambda s: s.replace('8500000', '8500001'))
add('tampered_status', result='REJECT', transform=lambda s: s.replace('"vnp_TransactionStatus":"00"', '"vnp_TransactionStatus":"02"'))
add('invalid_signature', result='REJECT', transform=lambda s: s.replace('"vnp_SecureHash":"', '"vnp_SecureHash":"0'))
for key in [k for k in FIELDS if k not in optional]:
    add('missing_' + key, {k: v for k, v in BASE.items() if k != key}, 'REJECT')
    add('empty_' + key, {**BASE, key: ''}, 'REJECT')
add('duplicate_key', result='REJECT', transform=lambda s: s[:-1] + ',"vnp_Amount":"8500000"}')
add('escaped_duplicate_key', result='REJECT', transform=lambda s: s[:-1] + ',"vnp_Amou\\u006et":"8500000"}')
add('unknown_key', result='REJECT', transform=lambda s: s[:-1] + ',"vnp_Unexpected":"x"}')
for value in ['8500000', 'null', 'true', '[]', '{}']:
    add('invalid_type_' + value, result='REJECT', transform=lambda s, v=value: s.replace('"8500000"', v))
for key, value in [('vnp_TmnCode', 'WRONG001'), ('vnp_TxnRef', 'a'*32), ('vnp_Amount', '8500001'),
                   ('vnp_TransactionNo', 'NaN'), ('vnp_TransactionNo', '0'), ('vnp_PayDate', '20260231090000'),
                   ('vnp_Command', 'refund')]:
    add('invalid_' + key + '_' + value, {**BASE, key: value}, 'REJECT')
for status, outcome in [('01', 'UNKNOWN'), ('02', 'FAILED'), ('04', 'REVIEW'), ('07', 'REVIEW'), ('88', 'REVIEW')]:
    add('status_' + status, {**BASE, 'vnp_TransactionStatus': status}, outcome)
add('refund_type', {**BASE, 'vnp_TransactionType': '02'}, 'REVIEW')
for code in ['91', '94', '97', '99']:
    add('api_error_' + code, {**BASE, 'vnp_ResponseCode': code}, 'REJECT')
request = dict(vnp_RequestId='a'*32, vnp_Version='2.1.0', vnp_Command='querydr', vnp_TmnCode='TEST0001',
               vnp_TxnRef=BASE['vnp_TxnRef'], vnp_TransactionDate='20261016235959', vnp_CreateDate='20261017070000',
               vnp_IpAddr='127.0.0.1', vnp_OrderInfo='Truy van BrewLite ' + BASE['vnp_TxnRef'])
canonical = '|'.join(request.values())
request['vnp_SecureHash'] = hmac.new(SECRET.encode(), canonical.encode(), hashlib.sha512).hexdigest()
output = dict(notice='INDEPENDENT SYNTHETIC CRYPTO ONLY; EXTERNAL SANDBOX RESPONSE VERIFICATION PENDING',
              secret=SECRET, request=dict(fields=request, canonical=canonical), vectors=vectors)
Path(__file__).with_name('vnpay-querydr-2.1.0.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
