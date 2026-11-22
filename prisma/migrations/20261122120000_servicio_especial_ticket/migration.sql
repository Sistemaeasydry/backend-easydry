-- Ticket opcional del servicio especial (letras o números, hasta 10 caracteres). Null = no es por ticket.
ALTER TABLE "ServicioEspecial" ADD COLUMN "ticket" TEXT;
CREATE INDEX "ServicioEspecial_ticket_idx" ON "ServicioEspecial"("ticket");
