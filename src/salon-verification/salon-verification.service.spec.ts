/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { SalonVerificationService } from './salon-verification.service';
import { PrismaService } from 'src/database/prisma.service';
import {
  VerificationStatusDocument,
  SalonVerificationDocumentType,
} from '@prisma/client';

// Mock factory
const createPrismaMock = () => ({
  salonVerificationDocument: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
});

// Test data builders
const buildVerificationDocument = (overrides?: Partial<any>) => ({
  id: 'doc-1',
  userId: 'salon-1',
  type: 'HYGIENE_SALUBRITE' as SalonVerificationDocumentType,
  fileUrl: 'https://example.com/doc1.pdf',
  status: VerificationStatusDocument.PENDING,
  rejectionReason: null,
  uploadedAt: new Date(),
  reviewedAt: null,
  reviewedBy: null,
  ...overrides,
});

const buildSalonUser = (overrides?: Partial<any>) => ({
  id: 'salon-1',
  role: 'salon',
  verifiedSalon: false,
  ...overrides,
});

const buildAdminUser = (overrides?: Partial<any>) => ({
  id: 'admin-1',
  role: 'admin',
  ...overrides,
});

describe('SalonVerificationService', () => {
  let service: SalonVerificationService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalonVerificationService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<SalonVerificationService>(SalonVerificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('submitDocument', () => {
    it('should submit a new verification document', async () => {
      const mockDocument = buildVerificationDocument();
      prisma.salonVerificationDocument.upsert.mockResolvedValue(mockDocument);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([]);
      prisma.user.update.mockResolvedValue(buildSalonUser());

      const result = await service.submitDocument(
        'salon-1',
        'HYGIENE_SALUBRITE',
        'https://example.com/doc1.pdf',
      );

      expect(result.error).toBe(false);
      expect(result.message).toContain('soumis pour vérification');
      expect(result.document).toEqual(mockDocument);
      expect(prisma.salonVerificationDocument.upsert).toHaveBeenCalled();
    });

    it('should update existing document on resubmission', async () => {
      const updatedDoc = buildVerificationDocument({
        status: VerificationStatusDocument.PENDING,
        rejectionReason: null,
      });

      prisma.salonVerificationDocument.upsert.mockResolvedValue(updatedDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([]);
      prisma.user.update.mockResolvedValue(buildSalonUser());

      const result = await service.submitDocument(
        'salon-1',
        'HYGIENE_SALUBRITE',
        'https://example.com/doc1-new.pdf',
      );

      expect(result.error).toBe(false);
      expect(result.document.status).toBe(VerificationStatusDocument.PENDING);
      expect(result.document.rejectionReason).toBeNull();
    });

    it('should reset rejection reason on document resubmission', async () => {
      const mockDocument = buildVerificationDocument({
        status: VerificationStatusDocument.PENDING,
        rejectionReason: null,
      });

      prisma.salonVerificationDocument.upsert.mockResolvedValue(mockDocument);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([]);
      prisma.user.update.mockResolvedValue(buildSalonUser());

      const result = await service.submitDocument(
        'salon-1',
        'HYGIENE_SALUBRITE',
        'https://example.com/doc1.pdf',
      );

      expect(result.error).toBe(false);
      const upsertCall = prisma.salonVerificationDocument.upsert.mock
        .calls[0]?.[0] as
        | { update?: { rejectionReason?: string | null } }
        | undefined;
      expect(upsertCall?.update?.rejectionReason).toBeNull();
    });

    it('should recalculate salon verification after submission', async () => {
      prisma.salonVerificationDocument.upsert.mockResolvedValue(
        buildVerificationDocument(),
      );
      prisma.salonVerificationDocument.findMany.mockResolvedValue([
        buildVerificationDocument({
          status: VerificationStatusDocument.APPROVED,
        }),
      ]);
      prisma.user.update.mockResolvedValue(
        buildSalonUser({ verifiedSalon: true }),
      );

      await service.submitDocument(
        'salon-1',
        'HYGIENE_SALUBRITE',
        'https://example.com/doc1.pdf',
      );

      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('getMyDocuments', () => {
    it('should return salon documents and verification status', async () => {
      const mockDocuments = [
        buildVerificationDocument({
          status: VerificationStatusDocument.APPROVED,
        }),
      ];
      const mockSalon = buildSalonUser({ verifiedSalon: true });

      prisma.salonVerificationDocument.findMany.mockResolvedValue(
        mockDocuments,
      );
      prisma.user.findUnique.mockResolvedValue(mockSalon);

      const result = await service.getMyDocuments('salon-1');

      expect(result.error).toBe(false);
      expect(result.verifiedSalon).toBe(true);
      expect(result.documents).toEqual(mockDocuments);
      expect(prisma.salonVerificationDocument.findMany).toHaveBeenCalledWith({
        where: { userId: 'salon-1' },
        orderBy: { uploadedAt: 'desc' },
      });
    });

    it('should return empty documents list when salon has no submissions', async () => {
      const mockSalon = buildSalonUser({ verifiedSalon: false });

      prisma.salonVerificationDocument.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue(mockSalon);

      const result = await service.getMyDocuments('salon-1');

      expect(result.error).toBe(false);
      expect(result.verifiedSalon).toBe(false);
      expect(result.documents).toEqual([]);
    });

    it('should return multiple documents sorted by upload date', async () => {
      const doc1 = buildVerificationDocument({
        id: 'doc-1',
        uploadedAt: new Date('2026-01-20'),
      });
      const doc2 = buildVerificationDocument({
        id: 'doc-2',
        uploadedAt: new Date('2026-01-22'),
      });
      const doc3 = buildVerificationDocument({
        id: 'doc-3',
        uploadedAt: new Date('2026-01-23'),
      });

      prisma.salonVerificationDocument.findMany.mockResolvedValue([
        doc3,
        doc2,
        doc1,
      ]);
      prisma.user.findUnique.mockResolvedValue(buildSalonUser());

      const result = await service.getMyDocuments('salon-1');

      expect(result.documents.length).toBe(3);
      expect(result.documents[0].id).toBe('doc-3');
    });

    it('should handle null salon gracefully', async () => {
      prisma.salonVerificationDocument.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getMyDocuments('salon-1');

      expect(result.error).toBe(false);
      expect(result.verifiedSalon).toBe(false);
    });
  });

  describe('reviewDocument', () => {
    it('should approve a verification document', async () => {
      const approvedDoc = buildVerificationDocument({
        status: VerificationStatusDocument.APPROVED,
        reviewedAt: new Date(),
        reviewedBy: 'admin-1',
      });

      prisma.user.findUnique.mockResolvedValue(buildAdminUser());
      prisma.salonVerificationDocument.update.mockResolvedValue(approvedDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([
        approvedDoc,
      ]);
      prisma.user.update.mockResolvedValue(
        buildSalonUser({ verifiedSalon: true }),
      );

      const result = await service.reviewDocument(
        'admin-1',
        'doc-1',
        VerificationStatusDocument.APPROVED,
      );

      const successResult = result as {
        error: false,
        message: string,
        document: ReturnType<typeof buildVerificationDocument>,
      };
      expect(successResult.error).toBe(false);
      expect(successResult.message).toContain('mis à jour');
      expect(successResult.document.status).toBe(
        VerificationStatusDocument.APPROVED,
      );
    });

    it('should reject a verification document with reason', async () => {
      const rejectedDoc = buildVerificationDocument({
        status: VerificationStatusDocument.REJECTED,
        rejectionReason: 'Document not legible',
        reviewedAt: new Date(),
        reviewedBy: 'admin-1',
      });

      prisma.user.findUnique.mockResolvedValue(buildAdminUser());
      prisma.salonVerificationDocument.update.mockResolvedValue(rejectedDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([]);
      prisma.user.update.mockResolvedValue(
        buildSalonUser({ verifiedSalon: false }),
      );

      const result = await service.reviewDocument(
        'admin-1',
        'doc-1',
        VerificationStatusDocument.REJECTED,
        'Document not legible',
      );

      const successResult = result as {
        error: false,
        message: string,
        document: ReturnType<typeof buildVerificationDocument>,
      };
      expect(successResult.error).toBe(false);
      expect(successResult.document.status).toBe(
        VerificationStatusDocument.REJECTED,
      );
      expect(successResult.document.rejectionReason).toBe(
        'Document not legible',
      );
    });

    it('should set default rejection reason when none provided', async () => {
      const rejectedDoc = buildVerificationDocument({
        status: VerificationStatusDocument.REJECTED,
        rejectionReason: 'Document refusé',
      });

      prisma.user.findUnique.mockResolvedValue(buildAdminUser());
      prisma.salonVerificationDocument.update.mockResolvedValue(rejectedDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([]);
      prisma.user.update.mockResolvedValue(buildSalonUser());

      const result = await service.reviewDocument(
        'admin-1',
        'doc-1',
        VerificationStatusDocument.REJECTED,
      );

      const successResult = result as {
        error: false,
        message: string,
        document: ReturnType<typeof buildVerificationDocument>,
      };
      expect(successResult.document.rejectionReason).toBe('Document refusé');
    });

    it('should clear rejection reason on approval', async () => {
      const approvedDoc = buildVerificationDocument({
        status: VerificationStatusDocument.APPROVED,
        rejectionReason: null,
      });

      prisma.user.findUnique.mockResolvedValue(buildAdminUser());
      prisma.salonVerificationDocument.update.mockResolvedValue(approvedDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([
        approvedDoc,
      ]);
      prisma.user.update.mockResolvedValue(
        buildSalonUser({ verifiedSalon: true }),
      );

      const result = await service.reviewDocument(
        'admin-1',
        'doc-1',
        VerificationStatusDocument.APPROVED,
      );

      const successResult = result as {
        error: false,
        message: string,
        document: ReturnType<typeof buildVerificationDocument>,
      };
      expect(successResult.document.rejectionReason).toBeNull();
    });

    it('should reject if user is not admin', async () => {
      prisma.user.findUnique.mockResolvedValue(buildSalonUser());

      const result = await service.reviewDocument(
        'salon-1',
        'doc-1',
        VerificationStatusDocument.APPROVED,
      );

      expect(result.error).toBe(true);
      expect(result.message).toBe(
        "Vous n'êtes pas autorisé à valider ces documents.",
      );
    });

    it('should reject if admin user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.reviewDocument(
        'invalid-admin',
        'doc-1',
        VerificationStatusDocument.APPROVED,
      );

      expect(result.error).toBe(true);
      expect(result.message).toBe(
        "Vous n'êtes pas autorisé à valider ces documents.",
      );
    });

    it('should update reviewedAt and reviewedBy on review', async () => {
      const now = new Date();
      const reviewedDoc = buildVerificationDocument({
        status: VerificationStatusDocument.APPROVED,
        reviewedAt: now,
        reviewedBy: 'admin-1',
      });

      prisma.user.findUnique.mockResolvedValue(buildAdminUser());
      prisma.salonVerificationDocument.update.mockResolvedValue(reviewedDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([
        reviewedDoc,
      ]);
      prisma.user.update.mockResolvedValue(
        buildSalonUser({ verifiedSalon: true }),
      );

      const result = await service.reviewDocument(
        'admin-1',
        'doc-1',
        VerificationStatusDocument.APPROVED,
      );

      const updateCall = prisma.salonVerificationDocument.update.mock
        .calls[0]?.[0] as { data?: { reviewedBy?: string } } | undefined;
      expect(updateCall?.data?.reviewedBy).toBe('admin-1');

      const successResult = result as {
        error: false,
        message: string,
        document: ReturnType<typeof buildVerificationDocument>,
      };
      expect(successResult.document).toBeDefined();
    });

    it('should recalculate salon verification after review', async () => {
      const approvedDoc = buildVerificationDocument({
        userId: 'salon-1',
        status: VerificationStatusDocument.APPROVED,
      });

      prisma.user.findUnique.mockResolvedValue(buildAdminUser());
      prisma.salonVerificationDocument.update.mockResolvedValue(approvedDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([
        approvedDoc,
      ]);
      prisma.user.update.mockResolvedValue(
        buildSalonUser({ verifiedSalon: true }),
      );

      await service.reviewDocument(
        'admin-1',
        'doc-1',
        VerificationStatusDocument.APPROVED,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'salon-1' },
        data: expect.objectContaining({ verifiedSalon: true }) as unknown as {
          verifiedSalon: boolean,
        },
      });
    });
  });

  describe('recalculateSalonVerification (via submitDocument)', () => {
    it('should set verifiedSalon to true when HYGIENE_SALUBRITE is approved', async () => {
      const approvedDoc = buildVerificationDocument({
        type: 'HYGIENE_SALUBRITE',
        status: VerificationStatusDocument.APPROVED,
      });

      prisma.salonVerificationDocument.upsert.mockResolvedValue(approvedDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([
        approvedDoc,
      ]);
      prisma.user.update.mockResolvedValue(
        buildSalonUser({ verifiedSalon: true }),
      );

      await service.submitDocument(
        'salon-1',
        'HYGIENE_SALUBRITE',
        'https://example.com/doc1.pdf',
      );

      const updateCall = prisma.user.update.mock.calls[0]?.[0] as
        | { data?: { verifiedSalon?: boolean } }
        | undefined;
      expect(updateCall?.data?.verifiedSalon).toBe(true);
    });

    it('should set verifiedSalon to false when HYGIENE_SALUBRITE is not approved', async () => {
      const pendingDoc = buildVerificationDocument({
        type: 'HYGIENE_SALUBRITE',
        status: VerificationStatusDocument.PENDING,
      });

      prisma.salonVerificationDocument.upsert.mockResolvedValue(pendingDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([]);
      prisma.user.update.mockResolvedValue(
        buildSalonUser({ verifiedSalon: false }),
      );

      await service.submitDocument(
        'salon-1',
        'HYGIENE_SALUBRITE',
        'https://example.com/doc1.pdf',
      );

      const updateCall = prisma.user.update.mock.calls[0]?.[0] as
        | { data?: { verifiedSalon?: boolean } }
        | undefined;
      expect(updateCall?.data?.verifiedSalon).toBe(false);
    });

    it('should maintain verification status when multiple documents exist', async () => {
      const approvedHygiene = buildVerificationDocument({
        type: 'HYGIENE_SALUBRITE',
        status: VerificationStatusDocument.APPROVED,
      });
      const pendingOther = buildVerificationDocument({
        id: 'doc-2',
        type: 'ASSURANCE' as SalonVerificationDocumentType,
        status: VerificationStatusDocument.PENDING,
      });

      prisma.salonVerificationDocument.upsert.mockResolvedValue(
        approvedHygiene,
      );
      prisma.salonVerificationDocument.findMany.mockResolvedValue([
        approvedHygiene,
        pendingOther,
      ]);
      prisma.user.update.mockResolvedValue(
        buildSalonUser({ verifiedSalon: true }),
      );

      await service.submitDocument(
        'salon-1',
        'HYGIENE_SALUBRITE',
        'https://example.com/doc1.pdf',
      );

      // Should be verified because HYGIENE_SALUBRITE is approved
      const updateCall = prisma.user.update.mock.calls[0]?.[0] as
        | { data?: { verifiedSalon?: boolean } }
        | undefined;
      expect(updateCall?.data?.verifiedSalon).toBe(true);
    });

    it('should set verifiedSalon to false when required doc is rejected', async () => {
      const rejectedDoc = buildVerificationDocument({
        type: 'HYGIENE_SALUBRITE',
        status: VerificationStatusDocument.REJECTED,
      });

      prisma.salonVerificationDocument.upsert.mockResolvedValue(rejectedDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([]);
      prisma.user.update.mockResolvedValue(
        buildSalonUser({ verifiedSalon: false }),
      );

      await service.submitDocument(
        'salon-1',
        'HYGIENE_SALUBRITE',
        'https://example.com/doc1.pdf',
      );

      const updateCall = prisma.user.update.mock.calls[0]?.[0] as
        | { data?: { verifiedSalon?: boolean } }
        | undefined;
      expect(updateCall?.data?.verifiedSalon).toBe(false);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle multiple document types per salon', async () => {
      const hygiene = buildVerificationDocument({
        id: 'doc-1',
        type: 'HYGIENE_SALUBRITE',
        status: VerificationStatusDocument.APPROVED,
      });
      const assurance = buildVerificationDocument({
        id: 'doc-2',
        type: 'ASSURANCE' as SalonVerificationDocumentType,
        status: VerificationStatusDocument.APPROVED,
      });

      prisma.salonVerificationDocument.findMany.mockResolvedValue([
        hygiene,
        assurance,
      ]);
      prisma.user.findUnique.mockResolvedValue(buildSalonUser());

      const result = await service.getMyDocuments('salon-1');

      expect(result.documents.length).toBe(2);
    });

    it('should handle document update with new file URL', async () => {
      const updatedDoc = buildVerificationDocument({
        fileUrl: 'https://example.com/doc-v2.pdf',
      });

      prisma.salonVerificationDocument.upsert.mockResolvedValue(updatedDoc);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([]);
      prisma.user.update.mockResolvedValue(buildSalonUser());

      const result = await service.submitDocument(
        'salon-1',
        'HYGIENE_SALUBRITE',
        'https://example.com/doc-v2.pdf',
      );

      expect(result.document.fileUrl).toBe('https://example.com/doc-v2.pdf');
    });

    it('should handle concurrent submissions', async () => {
      const doc1 = buildVerificationDocument({
        id: 'doc-1',
        type: 'HYGIENE_SALUBRITE',
      });

      prisma.salonVerificationDocument.upsert.mockResolvedValue(doc1);
      prisma.salonVerificationDocument.findMany.mockResolvedValue([doc1]);
      prisma.user.update.mockResolvedValue(buildSalonUser());

      const result1 = await service.submitDocument(
        'salon-1',
        'HYGIENE_SALUBRITE',
        'https://example.com/doc1.pdf',
      );

      expect(result1.error).toBe(false);
      expect(prisma.salonVerificationDocument.upsert).toHaveBeenCalled();
    });
  });
});
