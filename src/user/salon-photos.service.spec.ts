import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MAX_SALON_PHOTOS, SalonPhotosService } from './salon-photos.service';

const file = (n = 1) => ({ buffer: Buffer.alloc(16), size: 16 + n });

describe('SalonPhotosService', () => {
  let photos: string[];
  const users = {
    getPhotosSalon: jest.fn(async () => ({ salonPhotos: photos })),
    addOrUpdatePhotoSalon: jest.fn(async ({ salonPhotos }: { salonPhotos: string[] }) => { photos = salonPhotos; return {}; }),
  };
  const uploads = {
    storeImages: jest.fn(),
    discard: jest.fn(),
    deleteByUrls: jest.fn(),
  };
  const prisma = {
    uploadReservation: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
    tatoueur: { findMany: jest.fn() },
  };
  const service = new SalonPhotosService(users as never, uploads as never, prisma as never);

  beforeEach(() => {
    photos = ['https://utfs.io/f/a.jpg'];
    jest.clearAllMocks();
    prisma.uploadReservation.findFirst.mockResolvedValue({ id: 'r1' });
    prisma.user.findUnique.mockResolvedValue({ image: 'https://utfs.io/f/cover.jpg', profileImage: null, salonPhotos: [] });
    prisma.tatoueur.findMany.mockResolvedValue([{ img: 'https://utfs.io/f/tat.jpg' }]);
    uploads.storeImages.mockImplementation(async (_u: string, files: unknown[]) => files.map((_, i) => ({ url: `https://utfs.io/f/new${i}.jpg`, key: `new${i}`, size: 17 })));
  });

  it('ajoute les photos envoyées à la galerie existante', async () => {
    const res = await service.add('u1', [file(), file(2)], 'Bearer x');
    expect(uploads.storeImages).toHaveBeenCalledWith('u1', expect.any(Array), 'Bearer x', ['jpeg', 'png', 'webp', 'gif']);
    expect(res.salonPhotos).toEqual(['https://utfs.io/f/a.jpg', 'https://utfs.io/f/new0.jpg', 'https://utfs.io/f/new1.jpg']);
  });

  it('refuse un envoi qui dépasse la place restante, sans rien stocker', async () => {
    photos = Array.from({ length: MAX_SALON_PHOTOS - 1 }, (_, i) => `https://utfs.io/f/${i}.jpg`);
    await expect(service.add('u1', [file(), file(2)])).rejects.toBeInstanceOf(BadRequestException);
    expect(uploads.storeImages).not.toHaveBeenCalled();
  });

  it('retire les fichiers envoyés si l’enregistrement échoue', async () => {
    users.addOrUpdatePhotoSalon.mockRejectedValueOnce(new Error('db'));
    await expect(service.add('u1', [file()])).rejects.toThrow('db');
    expect(uploads.discard).toHaveBeenCalledTimes(1);
  });

  it('supprime une photo de la galerie et son fichier', async () => {
    const res = await service.remove('u1', 'https://utfs.io/f/a.jpg');
    expect(res.salonPhotos).toEqual([]);
    expect(uploads.deleteByUrls).toHaveBeenCalledWith(['https://utfs.io/f/a.jpg']);
  });

  it('refuse de supprimer une URL qui n’est pas dans la galerie', async () => {
    await expect(service.remove('u1', 'https://evil.example/x.jpg')).rejects.toBeInstanceOf(BadRequestException);
    expect(uploads.deleteByUrls).not.toHaveBeenCalled();
  });

  it('renvoie l’URL d’une image envoyée seule', async () => {
    const res = await service.uploadImage('u1', file(), 'Bearer x');
    expect(res).toEqual({ url: 'https://utfs.io/f/new0.jpg' });
    await expect(service.uploadImage('u1', undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('supprime une ancienne image qui lui appartient et qui n’est plus utilisée', async () => {
    await expect(service.deleteImage('u1', 'https://utfs.io/f/old.jpg')).resolves.toEqual({ ok: true });
    expect(uploads.deleteByUrls).toHaveBeenCalledWith(['https://utfs.io/f/old.jpg']);
  });

  it('refuse de supprimer une image d’un autre compte', async () => {
    prisma.uploadReservation.findFirst.mockResolvedValue(null);
    await expect(service.deleteImage('u1', 'https://utfs.io/f/other.jpg')).rejects.toBeInstanceOf(ForbiddenException);
    expect(uploads.deleteByUrls).not.toHaveBeenCalled();
  });

  it('refuse de supprimer une image encore affichée (couverture ou tatoueur)', async () => {
    await expect(service.deleteImage('u1', 'https://utfs.io/f/cover.jpg')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteImage('u1', 'https://utfs.io/f/tat.jpg')).rejects.toBeInstanceOf(BadRequestException);
    expect(uploads.deleteByUrls).not.toHaveBeenCalled();
  });
});
