const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
    const email = process.argv[2] || process.env.ADMIN_EMAIL;
    const password = process.argv[3] || process.env.ADMIN_PASSWORD;

    if (!email) {
        console.error("Set ADMIN_EMAIL or provide it as the first argument.");
        process.exit(1);
    }

    const existingUser = await prisma.user.findUnique({
        where: { email }
    });

    if (existingUser) {
        console.log(`User ${email} found. Promoting to SUPERADMIN...`);
        await prisma.user.update({
            where: { email },
            data: { role: 'SUPERADMIN' }
        });
        console.log("User promoted successfully!");
    } else {
        if (!password) {
            console.error("Set ADMIN_PASSWORD or provide it as the second argument to create a new admin.");
            process.exit(1);
        }

        console.log(`Creating new SUPERADMIN user ${email}...`);
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await prisma.user.create({
            data: {
                email,
                name: "Super Admin",
                password: hashedPassword,
                role: 'SUPERADMIN'
            }
        });
        console.log("Super Admin created successfully!");
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
