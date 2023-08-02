import express, {Request, Response} from 'express';
import swaggerUi from 'swagger-ui-express';
import bodyParser from 'body-parser';
import cors from 'cors';
import morgan from 'morgan';
import axios from 'axios';
import * as cheerio from 'cheerio';

export const app = express();
const host = process.env.HOST || '0.0.0.0';
const port = process.env.PORT || 443;
const packageJson = require('../package.json');
const swaggerSpec = require('./swagger.json');

app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors({
    origin: ["*"],
    allowedHeaders: ["cache-control", "x-requested-with", "nlb-tracker"],
    credentials: true
}));

// Serve Swagger UI
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes
app.get('/health', (req, res) => {
    res.send('OK');
});

app.post('/convert/:outputFormat', (req: Request, res: Response) => {
    // Get parameters from request body
    const { feedUrl, editionId } = req.body;
    const { outputFormat } = req.params;

    // Fetch metadata from the NLB API
    axios.get(`https://api.nlb.no/v1/editions/${editionId}?creative-work-metadata=all&edition-metadata=all&copies-metadata=none`).
    then((response) => {
        // Parse the response into a JSON object
        const resp = response.data;
        if (resp.statusCode === 200) {
            const metadata = resp.data;
            const today: string = new Date().toISOString().slice(2, 10).replace(/-/g, '');
            const date = new Date().toLocaleDateString('no-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    
            const language = metadata.creativeWork.language;
            const title = metadata.title + ' - ' + date;
            const uid = editionId + today;
            const generator = `${packageJson.name}/${packageJson.version}`;
            const publisher = 'NLB';
    
            // Get the language codes
            let dcLang = 'nb_NO';
            let xmlLang = 'no';
            switch (language) {
                case 'nob':
                    dcLang = 'nb_NO';
                    break;
                case 'nno':
                    dcLang = 'nn_NO';
                    break;
                case 'nor':
                    dcLang = 'no_NO';
                    break;
                case 'sme':
                    dcLang = 'se_NO';
                    xmlLang = 'se';
                    break;
                case 'eng':
                    xmlLang = 'en';
                    dcLang = 'en_US';
                    break;
                default:
                    break;
            }
    
            // Fetch RSS feed and store it in a Cheerio XML object
            axios.get(feedUrl).then((feedResponse) => {
                const input = cheerio.load(feedResponse.data, { xmlMode: true, decodeEntities: false });
                if(outputFormat === 'dtbook') {
                    // Parse the XML object into a DTBOOK object
                    let output = cheerio.load(`<?xml version="1.0" encoding="UTF-8"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"></dtbook>`, { xmlMode: true, decodeEntities: false });
        
                    // Add metadata to the output object
                    output('dtbook').attr('xml:lang', xmlLang);
                    output('dtbook').append('<head></head>');
                    output('head').append(`<meta name="dc:Language" content="${dcLang}"/>`);
                    output('head').append(`<meta name="dc:Title" content="${title}"/>`);
                    output('head').append(`<meta name="dtb:uid" content="${uid}"/>`);
                    output('head').append(`<meta name="dc:Publisher" content="${publisher}"/>`);
                    output('head').append(`<meta name="generator" content="${generator}"/>`);
                    output('head').append(`<meta name="description" content="Input document for Daisy production" />`);

                    // Add the book to the output object
                    output('dtbook').append('<book></book>');
                    output('book').append('<frontmatter></frontmatter>');
                    output('book').append('<bodymatter></bodymatter>');
                    output('book').append('<rearmatter></rearmatter>');

                    // Add about section to frontmatter
                    output('frontmatter').append(`<doctitle>${title}</doctitle>`);
                    output('frontmatter').append(`<level1><h1>Om ${publisher} sin lydversjon av ${metadata.title}</h1>
                    <p>Lydversjonen er basert på det redaksjonelle innholdet i papirutgaven av avisen og produsert på grunnlag av avtale mellom rettighetshaver og ${publisher}.</p>
                    <p>Lydversjonen er tilgjengelig fem dager i uken, enten som nedlastbar fil eller gjennom strømming. Lydversjonen distribueres også på CD, CD blir sendt via Posten og ihht Postens utsendelsestider men da bare for de utgavene som kommer på ukedager. Hvis du velger å høre på avisen ved å laste ned eller strømme, vil du få lydversjonen samtidig med at andre lesere får papirutgaven.</p>
                    <p>Den automatiske produksjonen av lydversjonen av avisen medfører at navn på artikkelforfattere av og til presenteres på en feilaktig eller misvisende måte.</p>
                    <p>Det kan også forekomme andre feil i lydversjonen, enten som et resultat av den automatiske produksjonen, eller på grunn av svakheter i det datamaterialet som danner grunnlaget for NLBs produksjon. Vi beklager dette, og jobber kontinuerlig med å forbedre produktet.</p>
                    <p>Kontakt oss, fortrinnsvis på NLB-utlaan@nb.no, dersom du har spørsmål om lydavisen.</p></level1>`);

                    let articles: {identifier: string, title: string, description: string, content: string, originalContent: string}[] = [];

                    // Add the articles to the bodymatter
                    input('item').each((i, elem) => {
                        const article = cheerio.load(elem, { xmlMode: true });
                        const articleTitle = article('title').text();
                        const articleDescription = article('description').text();
                        const articleContent = (article('content\\:encoded') !== undefined ? article('content\\:encoded').text() : '');

                        // Remove tables
                        let cleanedContent = articleContent.replace(/<table\b[^>]*>(.*?)<\/table>/g, '');
                        // Remove iframes
                        cleanedContent = cleanedContent.replace(/<iframe\b[^>]*>(.*?)<\/iframe>/g, '');
                        // Remove empty headings
                        cleanedContent = cleanedContent.replace(/<h[1-6]\b[^>]*>(.*?)<\/h[1-6]>/g, (match, p1) => {
                            if (p1.trim() === '') {
                                return '';
                            } else {
                                return match;
                            }
                        });
                        // Remove links (anchors)
                        cleanedContent = cleanedContent.replace(/<a\b[^>]*>(.*?)<\/a>/g, '$1');



                        // Remove paragraphs with a line break inside them
                        cleanedContent = cleanedContent.replace(/<p\b[^>]*>(.*?)<br\b[^>]*>(.*?)<\/p>/g, '<p>$1$2</p>');
                        // If paragraphs are nested inside paragraphs, remove the inner ones
                        cleanedContent = cleanedContent.replace(/<p\b[^>]*>(.*?)<p\b[^>]*>(.*?)<\/p>(.*?)<\/p>/g, '<p>$1$2$3</p>');
                        // Do this again to catch nested paragraphs inside nested paragraphs
                        cleanedContent = cleanedContent.replace(/<p\b[^>]*>(.*?)<p\b[^>]*>(.*?)<\/p>(.*?)<\/p>/g, '<p>$1$2$3</p>');
                        // Remove empty paragraphs
                        cleanedContent = cleanedContent.replace(/<p\b[^>]*>(.*?)<\/p>/g, (match, p1) => {
                            if (p1.trim() === '') {
                                return '';
                            } else {
                                return match;
                            }
                        });

                        // Generate a unique ID for the article
                        const articleId = 'article-' + i;

                        // Store it for use in table of contents
                        articles.push({identifier: articleId, title: articleTitle, description: articleDescription, content: cleanedContent, originalContent: articleContent});
                    });

                    // Add the articles to the body
                    articles.forEach((article) => {
                        output('bodymatter').append(`<level1><h1>${article.title}</h1>${article.description ? '<p>'+article.description+'</p>' : ''}<p>${article.content}</p></level1>`);
                    });

                    // Add endmatter to the rearmatter
                    output('rearmatter').append(`<level1><h1>Sluttannonsering</h1><p>Her slutter ${publisher} sin lydversjon av avisen.</p></level1>`);

                    // Return the NLBPUB object
                    res.send(output.xml());
                } else if(outputFormat === 'xhtml') {
                    // Here we convert to XHTML using the standard for the utgave-klargjort > punktskrift folder
                    let output = cheerio.load(`<?xml version="1.0" encoding="UTF-8"?><html><head></head><body></body></html>`, { xmlMode: true, decodeEntities: false });

                    // Add attributes to HTML element
                    output('html').attr('xml:lang', xmlLang);
                    output('html').attr('lang', xmlLang);
                    output('html').attr('xmlns', 'http://www.w3.org/1999/xhtml');
                    output('html').attr('xmlns:epub', 'http://www.idpf.org/2007/ops');
                    output('html').attr('epub:prefix', 'nordic: http://www.mtm.se/epub/ dcterms: http://purl.org/dc/terms/ z3998: http://www.daisy.org/z3998/2012/vocab/structure/#');

                    const isoDateTime = new Date().toISOString();
                    const nordicSupplier = 'Nasjonalbiblioteket';
                    const creator = 'Nasjonalbiblioteket: Avdeling for tilrettelagt litteratur';
                    const description = metadata.description || title;
                    const responsibilityStatement = metadata.responsibilityStatement || creator;

                    // Add metadata to the head element
                    output('head').append(`<meta charset="UTF-8"/>`);
                    output('head').append(`<title>${title}</title>`);
                    output('head').append(`<meta name="viewport" content="width=device-width, initial-scale=1" />`);
                    output('head').append(`<meta name="description" content="${description}" /> `);
                    output('head').append(`<meta name="dc:identifier" content="${uid}" />`);
                    output('head').append(`<meta name="dc:creator" content="${creator}" />`);
                    output('head').append(`<meta name="dc:language" content="${xmlLang}" />`);
                    output('head').append(`<meta name="nlbbib:responsibilityStatement" content="${responsibilityStatement}" />`);
                    if (metadata.genres && metadata.genres.length > 0) {
                        metadata.genres.forEach((genre: { name: string, identifier: string }) => {
                            output('head').append(`<meta name="dc:type.genre" content="${genre.name}" />`);
                        });
                    }
                    output('head').append(`<meta name="dc:type.fiction" content="${metadata.fiction || false}" />`);
                    if (metadata.audiences && metadata.audiences.length > 0) {
                        metadata.audiences.forEach((audience: { identifier: string, age_from: number, age_to: number, name: string }) => {
                            output('head').append(`<meta name="schema:audience" content="${audience.identifier}" />`);
                            output('head').append(`<meta name="schema:typicalAgeRange" content="${audience.age_from}-${audience.age_to ? audience.age_to : ''}" />`);
                        });
                    }
                    output('head').append(`<meta name="dc:format" content="Braille" />`);
                    output('head').append(`<meta name="dc:format.no" content="Punktskrift" />`);
                    output('head').append(`<meta name="dc:publisher" content="${publisher}" />`);
                    output('head').append(`<meta name="dc:type.braille" content="true" />`);
                    output('head').append(`<meta name="nlbbib:sortingKey" content="${creator}" />`);
                    output('head').append(`<meta name="dc:source.urn-nbn" content="urn:nbn:no-nb_nlb_${uid}" />`);
                    output('head').append(`<meta name="nlbbib:websok.url" content="https://websok.nlb.no/cgi-bin/websok?tnr=${editionId}" />`);
                    output('head').append(`<meta name="schema:library" content="${nordicSupplier}" />`);
                    output('head').append(`<meta name="dcterms:modified" content="${isoDateTime}" />`);

                    if (metadata.available) {
                        output('head').append(`<meta name="dc:date.available" content="${metadata.available}" />`);
                    }
                    if (metadata.publishedYear) {
                        output('head').append(`<meta name="dc:date.issued" content="${metadata.publishedYear}" />`);
                        output('head').append(`<meta name="dc:date.issued.original" content="${metadata.publishedYear}" />`);
                    }
                    if (metadata.registered) {
                        output('head').append(`<meta name="dc:date.registered" content="${metadata.registered}" />`);
                    }
                    if (metadata.pages) {
                        output('head').append(`<meta name="dc:format.extent.original" content="${metadata.pages} sider" />`);
                        output('head').append(`<meta name="dc:format.extent.pages" content="${metadata.pages}" />`);
                    }
                    if (metadata.volumes) {
                        output('head').append(`<meta name="dc:format.extent.volumes" content="${metadata.volumes}" />`);
                    }
                    if (metadata.publishedLocation) {
                        output('head').append(`<meta name="dc:publisher.location" content="${metadata.publishedLocation}" />`);
                        output('head').append(`<meta name="dc:publisher.location.original" content="${metadata.publishedLocation}" />`);
                    }
                    if (metadata.publisher) {
                        output('head').append(`<meta name="dc:publisher.original" content="${metadata.publisher}" />`);
                    }
                    if (metadata.subjects && metadata.subjects.length > 0) {
                        metadata.subjects.forEach((subject: { identifier: string, name: string, location: string, dewey: string }) => {
                            if (subject.dewey) {
                                output('head').append(`<meta name="dc:subject.dewey" content="${subject.dewey}" />`);
                            } else {
                                output('head').append(`<meta name="dc:subject.keyword" content="${subject.name}" />`);
                            }
                        });
                    }
                    if (metadata.subTitle) {
                        output('head').append(`<meta name="dc:title.subTitle" content="${metadata.subTitle}" />`);
                    }
                    if (metadata.edition) {
                        output('head').append(`<meta name="schema:bookEdition" content="${metadata.edition}" />`);
                        output('head').append(`<meta name="schema:bookEdition.original" content="${metadata.edition}" />`);
                    }
                    if (metadata.isbn) {
                        output('head').append(`<meta name="schema:isbn" content="${metadata.isbn}" />`);
                        output('head').append(`<meta name="schema:isbn.original" content="${metadata.isbn}" />`);
                    }

                    // Add a title page to the body
                    output('body').append(`<section class="pef-titlepage"><p> </p><p> </p><p> </p><p> </p><p> </p><p> </p><p>${title}</p><p> </p><p> </p><p> </p><p> </p><p> </p><p> </p><p> </p><p> </p><p> </p><p> </p><p> </p><p> </p><p> </p><p> </p>cccccccccccccccccccccccccccccccc<p>${metadata.publisher}, ${metadata.publishedYear}</p><p> </p><p> </p><p><span class="pef-volume"> av </span></p><p class="Høyre-justert">${editionId}</p></section>`);

                    let articles: {identifier: string, title: string, description: string, content: string, originalContent: string}[] = [];

                    // Create an array of articles
                    input('item').each((i, elem) => {
                        const article = cheerio.load(elem, { xmlMode: true });
                        const articleTitle = article('title').text();
                        const articleDescription = article('description').text();
                        const articleContent = (article('content\\:encoded') !== undefined ? article('content\\:encoded').text() : '');

                        // Remove tables
                        let cleanedContent = articleContent.replace(/<table\b[^>]*>(.*?)<\/table>/g, '');
                        // Remove iframes
                        cleanedContent = cleanedContent.replace(/<iframe\b[^>]*>(.*?)<\/iframe>/g, '');
                        // Remove empty headings
                        cleanedContent = cleanedContent.replace(/<h[1-6]\b[^>]*>(.*?)<\/h[1-6]>/g, (match, p1) => {
                            if (p1.trim() === '') {
                                return '';
                            } else {
                                return match;
                            }
                        });
                        // Remove links (anchors)
                        cleanedContent = cleanedContent.replace(/<a\b[^>]*>(.*?)<\/a>/g, '$1');



                        // Remove paragraphs with a line break inside them
                        cleanedContent = cleanedContent.replace(/<p\b[^>]*>(.*?)<br\b[^>]*>(.*?)<\/p>/g, '<p>$1$2</p>');
                        // If paragraphs are nested inside paragraphs, remove the inner ones
                        cleanedContent = cleanedContent.replace(/<p\b[^>]*>(.*?)<p\b[^>]*>(.*?)<\/p>(.*?)<\/p>/g, '<p>$1$2$3</p>');
                        // Do this again to catch nested paragraphs inside nested paragraphs
                        cleanedContent = cleanedContent.replace(/<p\b[^>]*>(.*?)<p\b[^>]*>(.*?)<\/p>(.*?)<\/p>/g, '<p>$1$2$3</p>');
                        // Remove empty paragraphs
                        cleanedContent = cleanedContent.replace(/<p\b[^>]*>(.*?)<\/p>/g, (match, p1) => {
                            if (p1.trim() === '') {
                                return '';
                            } else {
                                return match;
                            }
                        });

                        // Generate a unique ID for the article
                        const articleId = 'article-' + i;

                        // Store it for use in table of contents
                        articles.push({identifier: articleId, title: articleTitle, description: articleDescription, content: cleanedContent, originalContent: articleContent});
                    });

                    // Add a table of contents to the body
                    //output('body').append(`<section epub:type="frontmatter toc"><h1>Innholdsfortegnelse</h1><ol></ol></section>`);
                    //articles.forEach((article) => {
                        //output('.toc').append(`<li><a href="#${article.identifier}">${article.title}</a></li>`);
                    //});

                    // Add the articles to the body
                    articles.forEach((article) => {
                        output('body').append(`<section epub:type="bodymatter chapter" id="${article.identifier}"><h1>${article.title}</h1>${article.description ? '<p>'+article.description+'</p>' : ''}<p>${article.content}</p></section>`);
                        output('body').append(`<hr class="emptyline" />`);
                    });

                    // Return the NLBPUB object
                    res.send(output.xml());
                }
            });
        } else {
            res.status(resp.statusCode).json(resp);
        }
    }).
    catch((error) => {
        console.log(error);
        res.status(500).json({ error: 'Something went wrong' });
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening at http://${host}:${port}`);
});
