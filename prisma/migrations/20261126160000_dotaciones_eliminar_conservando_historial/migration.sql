-- Eliminar categorías, productos y planes de dotación ya no borra nada con historial: solo dejan de listarse.
ALTER TABLE "dotaciones_categorias" ADD COLUMN "eliminadoEn" TIMESTAMP(3);
ALTER TABLE "dotaciones_productos" ADD COLUMN "eliminadoEn" TIMESTAMP(3);
ALTER TABLE "dotaciones_planes" ADD COLUMN "eliminadoEn" TIMESTAMP(3);
