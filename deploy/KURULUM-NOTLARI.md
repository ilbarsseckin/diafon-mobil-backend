# Sunucu Kurulum Notlari

## go2rtc (kamera RTSP -> WebRTC koprusu)
- docker-compose.yml icinde `go2rtc` servisi (network_mode: host)
- Config: go2rtc/go2rtc.yaml
- API `0.0.0.0:1984` dinler AMA iptables ile disariya kapali:
  `iptables -A INPUT -p tcp --dport 1984 -i eth0 -j DROP`
  (kalici: iptables-persistent + netfilter-persistent save)
- Backend go2rtc'ye `GO2RTC_API=http://172.22.0.1:1984` ile ulasir
  (docker bridge gateway; backend compose environment'inda tanimli)
- ICE server olarak coturn kullanir (turn:128.140.127.151:3478)

## Kamera akisi
- Building tablosunda: camera_rtsp_url, camera_enabled, camera_stream_id
- CameraService backend acilista DB'deki aktif kameralari go2rtc'ye yukler (sync)
- Endpoint: POST door/set-camera, GET door/camera/:buildingId

## coturn
- realm: turn.mobildiafon.com
- user: diafonturn / turnpass2026
