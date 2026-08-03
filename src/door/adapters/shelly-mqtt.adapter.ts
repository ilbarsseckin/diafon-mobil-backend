import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { DoorAdapter } from './door-adapter.interface';
import { connect, MqttClient } from 'mqtt';

// Shelly Gen3/Gen4 role - kendi Mosquitto broker'imiz uzerinden kapi acma.
// Cihaz "momentary + auto-off" modunda: acinca kontagi ~2 sn cekip birakir.
// .env: MQTT_URL, MQTT_USER, MQTT_PASSWORD
// deviceId = Shelly'nin MQTT prefix'i, or. "shelly1g3-a8032ab12345"
@Injectable()
export class ShellyMqttAdapter implements DoorAdapter, OnModuleDestroy {
  private readonly logger = new Logger('ShellyMqttAdapter');
  private readonly url = process.env.MQTT_URL || 'mqtt://mosquitto:1883';
  private readonly username = process.env.MQTT_USER || 'backend';
  private readonly password = process.env.MQTT_PASSWORD || '';
  private client: MqttClient | null = null;
  private connecting: Promise<MqttClient> | null = null;

  private ensureClient(): Promise<MqttClient> {
    if (this.client && this.client.connected) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<MqttClient>((resolve, reject) => {
      const c = connect(this.url, {
        username: this.username,
        password: this.password,
        connectTimeout: 5000,
        reconnectPeriod: 3000,
      });
      const onError = (err: Error) => {
        this.logger.error('MQTT baglanti hatasi: ' + err.message);
        c.end(true);
        this.connecting = null;
        reject(new Error('MQTT brokera baglanilamadi'));
      };
      c.once('connect', () => {
        c.removeListener('error', onError);
        c.on('error', (e) => this.logger.warn('MQTT: ' + e.message));
        c.on('reconnect', () => this.logger.warn('MQTT yeniden baglaniyor...'));
        this.client = c;
        this.connecting = null;
        this.logger.log('MQTT baglandi: ' + this.url);
        resolve(c);
      });
      c.once('error', onError);
    });
    return this.connecting;
  }

  // Cihazin yanitini bekler: publish "gonderildi" demek, "acildi" demek DEGIL.
  // Cihaz offline ise publish basarili olur ama kapi acilmaz -> kullaniciya
  // yanlis "acildi" mesaji gider. Bu yuzden RPC cevabini bekliyoruz.
  async open(deviceId: string, pulseSeconds = 2): Promise<void> {
    if (!deviceId) throw new Error('deviceId bos');
    const client = await this.ensureClient();

    const reqId = Date.now();
    const topic = deviceId + '/rpc';
    const RESPONSE_TOPIC = 'diafon-backend/rpc';
    const payload = JSON.stringify({
      id: reqId,
      src: 'diafon-backend',
      method: 'Switch.Set',
      params: { id: 0, on: true },
    });

    await new Promise<void>((resolve, reject) => {
      let bitti = false;

      const temizle = () => {
        clearTimeout(zamanAsimi);
        client.removeListener('message', onMessage);
      };

      const onMessage = (t: string, msg: Buffer) => {
        if (t !== RESPONSE_TOPIC) return;
        try {
          const cevap = JSON.parse(msg.toString());
          if (cevap.id !== reqId) return; // baska bir istegin cevabi
          bitti = true;
          temizle();
          if (cevap.error) {
            this.logger.warn('Cihaz hatasi ' + deviceId + ': ' + JSON.stringify(cevap.error));
            reject(new Error('Kapi acilamadi (cihaz reddetti)'));
          } else {
            this.logger.log('Kapi acildi (cihaz onayladi): ' + deviceId);
            this.emniyetKapat(deviceId, pulseSeconds);
            resolve();
          }
        } catch {
          // JSON degilse yoksay
        }
      };

      const zamanAsimi = setTimeout(() => {
        if (bitti) return;
        temizle();
        this.logger.warn('Cihaz yanit vermedi: ' + deviceId);
        reject(new Error('Kapi cihazina ulasilamadi. Cihaz cevrimdisi olabilir.'));
      }, 4000);

      client.subscribe(RESPONSE_TOPIC, { qos: 0 }, (subErr) => {
        if (subErr) {
          temizle();
          return reject(new Error('Kapi acma kanali kurulamadi'));
        }
        client.on('message', onMessage);
        client.publish(topic, payload, { qos: 1 }, (err) => {
          if (err) {
            temizle();
            this.logger.error('Yayin hatasi ' + topic + ': ' + err.message);
            reject(new Error('Kapi acma komutu gonderilemedi'));
          }
        });
      });
    });
  }

  // EMNIYET KEMERI: cihazin auto_off ayari kaybolmussa role cekili kalir
  // (kapi kilidi surekli enerjide). Komuttan N sn sonra yedek kapatma yolluyoruz.
  // Cihaz zaten kendi birakmissa bu komut zararsizdir.
  private emniyetKapat(deviceId: string, saniye: number) {
    const gecikme = Math.min(Math.max(saniye, 1), 60) * 1000 + 1500;
    setTimeout(() => {
      this.ensureClient()
        .then((client) => {
          const payload = JSON.stringify({
            id: Date.now(),
            src: 'diafon-backend',
            method: 'Switch.Set',
            params: { id: 0, on: false },
          });
          client.publish(deviceId + '/rpc', payload, { qos: 1 });
        })
        .catch(() => {/* baglanti yoksa sessiz gec */});
    }, gecikme);
  }

  // Role cekme suresini uzaktan degistir (auto_off_delay)
  // Sure cihazda saklanir: internet kesilse bile role kendi birakir.
  async setPulse(deviceId: string, saniye: number): Promise<void> {
    if (!deviceId) throw new Error('deviceId bos');
    if (saniye < 0.5 || saniye > 60) throw new Error('Sure 0.5-60 saniye arasinda olmali');
    const client = await this.ensureClient();
    const payload = JSON.stringify({
      id: Date.now(),
      src: 'diafon-backend',
      method: 'Switch.SetConfig',
      params: { id: 0, config: { auto_off: true, auto_off_delay: saniye, initial_state: 'off' } },
    });
    await new Promise<void>((resolve, reject) => {
      client.publish(deviceId + '/rpc', payload, { qos: 1 }, (err) => {
        if (err) reject(new Error('Sure ayari gonderilemedi'));
        else {
          this.logger.log('Role suresi ' + saniye + 's olarak ayarlandi: ' + deviceId);
          resolve();
        }
      });
    });
  }

  // Cihaz canli mi? Shelly'nin <prefix>/online topic'ini dinler.
  async verify(deviceId: string): Promise<{ ok: boolean; online?: boolean; message?: string }> {
    if (!deviceId) return { ok: false, message: 'deviceId bos' };
    try {
      const client = await this.ensureClient();
      const statusTopic = deviceId + '/online';
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          client.unsubscribe(statusTopic);
          client.removeListener('message', onMessage);
          resolve({ ok: false, online: false, message: 'Cihazdan yanit yok (offline veya yanlis deviceId)' });
        }, 4000);
        const onMessage = (topic: string, msg: Buffer) => {
          if (topic === statusTopic) {
            clearTimeout(timeout);
            client.unsubscribe(statusTopic);
            client.removeListener('message', onMessage);
            const online = msg.toString() === 'true';
            resolve({ ok: online, online, message: online ? undefined : 'Cihaz offline' });
          }
        };
        client.on('message', onMessage);
        client.subscribe(statusTopic, { qos: 0 });
      });
    } catch (e: any) {
      return { ok: false, message: e.message || 'MQTT hatasi' };
    }
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
  }
}
