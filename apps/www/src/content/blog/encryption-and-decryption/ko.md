---
title: Synch의 종단 간 암호화는 어떻게 동작하나요?
description: 여러 기기에서 vault를 열어도 서버가 노트 내용을 읽지 못하게 하는 Synch의 암호화 방식을 쉽게 풀어 설명합니다.
pubDate: 2026-05-01
---

종단 간 암호화는 데이터가 내 기기를 떠나기 전에 잠기고 다시 내 기기에서만 열리는 방식입니다.

Synch 서버는 데이터를 저장하고 동기화하는 일을 돕습니다. 하지만 그 데이터를 읽는 데 필요한 비밀키는 가지고 있지 않습니다.

큰 흐름은 이렇습니다.

```txt
내 기기: 읽을 수 있는 노트 -> 암호화된 데이터
서버: 암호화된 데이터 저장
다른 기기: 암호화된 데이터 -> 읽을 수 있는 노트
```

암호화 전의 노트는 이렇게 생겼을 수 있습니다.

```txt
Hello, this is my private note.
```

암호화한 뒤에는 무작위처럼 보이는 데이터가 됩니다.

```txt
K9sV1xQ4...unreadable bytes...
```

이 데이터를 다시 원래 노트로 되돌리려면 올바른 키가 필요합니다.

## 핵심 질문

암호화에서 가장 중요한 질문은 결국 이것입니다.

> 누가 키를 가지고 있나요?

Synch에서는 사용자의 기기가 키를 가지고 있습니다. 서버는 암호화된 데이터를 저장하지만 그 데이터를 읽을 수 있는 평문 키는 받지 않습니다.

파일 내용과 파일 경로 같은 메타데이터는 업로드되기 전에 먼저 사용자의 기기에서 암호화됩니다. 다른 기기는 서버에서 암호화된 데이터를 내려받을 수 있습니다. 하지만 같은 vault key를 그 기기 안에서 열어야만 데이터를 읽을 수 있습니다.

이제 이 과정이 어떻게 이어지는지 하나씩 살펴보겠습니다.

## 두 가지 비밀

Synch에서 원격 vault를 만들 때 사용자는 vault 비밀번호를 정합니다.

![Create vault screen](./create-vault.png)

이 비밀번호가 모든 파일을 직접 암호화한다고 생각하기 쉽습니다.

하지만 그렇지 않습니다.

Synch에는 서로 다른 역할을 하는 두 가지 비밀이 있습니다.

```txt
vault 비밀번호: 사용자가 기억하고 입력하는 비밀번호
vault key: Synch가 무작위로 만든 키
```

실제로 동기화되는 vault 데이터를 암호화하고 복호화하는 키는 vault key입니다.

vault 비밀번호의 역할은 다릅니다. vault key를 안전하게 보호하고 다른 기기에서도 그 vault key를 열 수 있게 해줍니다.

쉽게 말하면 이렇게 볼 수 있습니다.

```txt
vault key = 내 데이터를 여는 키
vault 비밀번호 = vault key를 여는 키
```

이 단계를 나누는 이유가 있습니다. 사람이 정한 비밀번호는 보통 암호화 키로 바로 쓰기에는 충분히 무작위적이지 않습니다. 사람 눈에는 강해 보여도 컴퓨터는 수많은 후보를 빠르게 시도할 수 있습니다.

그래서 Synch는 실제 데이터 암호화에 쓸 무작위 32바이트 vault key를 만듭니다.

```txt
password = "my-strong-password"
vaultKey = "random-32-byte-key"
```

그리고 이 vault key를 사용자의 비밀번호로 보호합니다.

## Vault Key를 보호하는 방식

Synch가 vault key를 서버에 그대로 저장하면 안 됩니다. 그렇게 하면 서버가 암호화된 데이터를 읽을 수 있게 됩니다.

그래서 Synch는 vault key를 암호화한 형태로 저장합니다.

먼저 사용자의 비밀번호를 더 강한 키로 바꿉니다. 이 키를 `wrapKey`라고 부릅니다.

```txt
password + salt + Argon2id settings
=> wrapKey
```

`wrapKey`는 파일을 암호화하는 데 쓰이지 않습니다. vault key를 암호화해서 감싸는 데만 쓰입니다.

Synch는 Argon2id로 비밀번호에서 `wrapKey`를 만듭니다.

```txt
Argon2id(
  password = "my-strong-password",
  salt = random 16 bytes,
  memory = 64 MiB,
  iterations = 3,
  parallelism = 1
)
=> wrapKey
```

Argon2id는 비밀번호를 암호화 키로 바꾸는 함수입니다. 일부러 계산 비용이 들게 만들어져 있어서 공격자가 비밀번호를 하나씩 추측하는 속도를 늦춥니다.

salt는 암호화된 vault key와 함께 저장되는 무작위 데이터입니다. 비밀은 아닙니다. 같은 비밀번호를 쓰더라도 vault마다 같은 결과가 나오지 않게 해주는 역할을 합니다.

같은 비밀번호와 같은 salt 그리고 같은 설정을 넣으면 Synch는 같은 `wrapKey`를 다시 만들 수 있습니다. 비밀번호가 틀리면 다른 `wrapKey`가 만들어집니다.

이제 Synch는 `wrapKey`로 vault key를 암호화합니다.

```txt
AES-GCM encrypt (
  key = wrapKey,
  nonce = random 12 bytes,
  plaintext = vaultKey
)
=> encrypted vaultKey
```

여기서 AES-GCM은 암호화 방식입니다. nonce는 암호화할 때 필요한 값입니다. 매번 고유해야 하지만 숨길 필요는 없습니다.

이제 서버는 암호화된 vault key 묶음을 저장할 수 있습니다.

```json
{
  "kdf": {
    "name": "argon2id",
    "memoryKiB": 65536,
    "iterations": 3,
    "parallelism": 1,
    "salt": "b64_salt"
  },
  "wrap": {
    "algorithm": "aes-256-gcm",
    "nonce": "b64_nonce",
    "ciphertext": "b64_encrypted_vaultKey"
  }
}
```

이 묶음은 나중에 Synch 클라이언트가 vault key를 다시 열어볼 때 필요한 설명서에 가깝습니다. 서버에게 비밀번호나 vault key를 주는 것은 아닙니다.

서버가 가진 것은 이런 정보입니다.

```txt
salt
Argon2id 설정
nonce
암호화된 vaultKey
```

서버가 가지고 있지 않은 것은 다음 값들입니다.

```txt
password
wrapKey
vaultKey
```

이 차이가 종단 간 암호화의 핵심입니다.

## 서버가 볼 수 있는 것과 볼 수 없는 것

서버에는 vault key가 없습니다. 그래서 파일 내용이나 복호화된 파일 경로를 읽을 수 없습니다.

서버는 암호화된 데이터와 사용자의 기기가 나중에 그 데이터를 열기 위해 필요한 정보만 저장합니다.

물론 종단 간 암호화가 모든 정보를 숨기는 것은 아닙니다. 동기화 서비스를 운영하려면 계정 정보와 vault 식별자 그리고 암호화된 객체의 크기나 업데이트 시각 같은 정보가 필요할 수 있습니다. 동기화 활동에 관한 정보도 서버가 볼 수 있습니다.

중요한 경계는 서버 혼자서는 암호화된 vault 데이터를 읽을 수 있는 노트로 되돌릴 수 없어야 한다는 점입니다.

## 파일과 메타데이터 암호화

기기에서 vault key가 열리면 Synch는 이 키를 동기화 데이터의 root secret으로 사용합니다.

파일 내용은 업로드되기 전에 암호화됩니다. 파일 경로 같은 메타데이터도 업로드되기 전에 암호화됩니다. 암호화되는 각 항목은 자신만의 nonce를 사용합니다. 이 nonce는 암호화된 데이터와 함께 저장되고 나중에 복호화할 때 다시 쓰입니다.

서버는 암호화된 데이터만 저장합니다. 평문 파일 내용이나 평문 파일 경로 그리고 vault key는 저장하지 않습니다.

## 다른 기기에서 Vault 열기

![Connect vault screen](./connect-vault.png)

다른 기기가 같은 원격 vault에 연결하면 먼저 서버에서 암호화된 vault key 묶음을 내려받습니다.

그다음 그 기기에서 vault 비밀번호를 입력합니다.

Synch는 저장된 salt와 Argon2id 설정을 사용해 같은 `wrapKey`를 다시 만듭니다.

```txt
Argon2id(password, same salt, same settings)
=> same wrapKey
```

비밀번호가 맞으면 기기는 그 `wrapKey`로 암호화된 vault key를 복호화합니다.

```txt
AES-GCM decrypt(
  key = wrapKey,
  nonce = stored nonce,
  ciphertext = encrypted vaultKey
)
=> vaultKey
```

기기가 vault key를 얻으면 동기화된 파일과 메타데이터를 로컬에서 복호화할 수 있습니다.

비밀번호가 틀리면 다른 `wrapKey`가 만들어지고 vault key 복호화는 실패합니다.

## 그래도 Vault 비밀번호가 중요한 이유

vault 비밀번호가 모든 파일을 직접 암호화하는 것은 아닙니다. vault 비밀번호는 vault key를 열고 실제 동기화 데이터는 vault key가 암호화합니다.

그래도 vault 비밀번호는 아주 중요합니다.

누군가 암호화된 vault key 묶음을 가져가면 그 사본을 가지고 오프라인에서 비밀번호를 추측해볼 수 있습니다. Argon2id는 추측 한 번 한 번을 더 비싸게 만들지만 쉽게 맞힐 수 있는 비밀번호까지 대신 지켜주지는 못합니다.

vault 비밀번호를 잊어버리면 Synch는 vault를 복구해줄 수 없습니다. 비밀번호가 있어야 `wrapKey`를 만들 수 있고 `wrapKey`가 있어야 vault key를 열 수 있습니다. 둘 중 하나라도 없으면 암호화된 vault 데이터를 읽을 수 없습니다.

그래서 비밀번호를 잃었을 때 서버가 대신 되살려 줄 수도 없습니다. vault를 열 키를 만드는 재료인 비밀번호는 처음부터 서버로 보내지 않기 때문입니다.

정리하면, 서버는 암호화된 vault를 저장하고 동기화하는 역할만 하고 노트를 읽을 수 있게 해석하는 작업은 모두 사용자 기기에서 이루어집니다. 데이터를 읽는 데 필요한 키는 서버에 존재하지 않습니다.
