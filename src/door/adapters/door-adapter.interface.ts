// Kapi acma adaptor arayuzu - Tuya/IPRole/ESP32 hepsi bunu uygular
export interface DoorAdapter {
  // deviceId'deki kapiyi acar. Basarili ise true, degilse hata firlatir.
  open(deviceId: string): Promise<void>;
}
