-- Fines de semana trabajados solo de forma temporal: una fila por persona y fecha (sábado o domingo). Solo suma una tabla.
CREATE TABLE "horarios_excepcion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "entrada" TEXT NOT NULL,
    "salida" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladaEn" TIMESTAMP(3),
    "anuladaPorId" TEXT,

    CONSTRAINT "horarios_excepcion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "horarios_excepcion_userId_fecha_idx" ON "horarios_excepcion"("userId", "fecha");
CREATE INDEX "horarios_excepcion_fecha_idx" ON "horarios_excepcion"("fecha");

ALTER TABLE "horarios_excepcion" ADD CONSTRAINT "horarios_excepcion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
