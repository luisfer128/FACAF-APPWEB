import smtplib

try:
    server = smtplib.SMTP('smtp.office365.com', 587)
    server.set_debuglevel(1)
    server.starttls()
    server.login('pruebafacaf@outlook.es', 'hpstuoyqpfdmfvwn')
    print("✅ Conexión SMTP exitosa")
    server.quit()
except Exception as e:
    print("❌ Error SMTP:", e)
