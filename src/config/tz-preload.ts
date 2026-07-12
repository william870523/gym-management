// gym-local-api / gym-remote-api — preload de zona horaria.
//
// Se carga ANTES que cualquier otro módulo (vía `bun --preload`) para fijar
// la zona horaria del proceso a UTC. Esto controla Date/Intl del proceso, no
// la sesión de MariaDB; MariaDB se configura por separado con
// default_time_zone='+00:00'. Las marcas de tiempo se almacenan como instantes
// UTC y la zona del gimnasio solo se aplica al mostrar/calcular días naturales.
//
// Ver: src/config/tz.ts para los helpers de conversión.
process.env.TZ = "UTC";
