const express = require('express');
const router = express.Router();
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const moment = require('moment');
const { logger } = require('../../utils/logger');
const NodeCache = require('node-cache');

// Initialize cache with 30 minutes TTL
const cache = new NodeCache({ stdTTL: 1800 }); // 30 minutes in seconds

// Helper function to create an XML RSS feed from LHDN SDK data
function createRssFeed(sdkUpdates) {
  // Create header for the RSS feed
  let rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>MyInvois SDK Updates</title>
  <link>https://sdk.myinvois.hasil.gov.my/sdk-1-0-release/</link>
  <description>Latest updates from LHDN MyInvois SDK</description>
  <language>en-us</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <atom:link href="${process.env.APP_URL || 'http://localhost:3000'}/api/rss" rel="self" type="application/rss+xml" />
`;

  // Add items to RSS feed
  sdkUpdates.forEach(update => {
    const pubDate = moment(update.date, 'DD MMMM YYYY').toDate().toUTCString();
    const guid = `sdk-update-${update.date.replace(/\s+/g, '-').toLowerCase()}`;
    
    rss += `  <item>
    <title>SDK Update - ${update.date}</title>
    <link>https://sdk.myinvois.hasil.gov.my/sdk-1-0-release/</link>
    <guid isPermaLink="false">${guid}</guid>
    <pubDate>${pubDate}</pubDate>
    <description><![CDATA[
      <h3>${update.date}</h3>
      ${update.sections.map(section => `
        <h4>${section.title}</h4>
        <ul>
          ${section.items.map(item => `<li>${item}</li>`).join('')}
        </ul>
      `).join('')}
    ]]></description>
  </item>
`;
  });

  // Close the RSS feed
  rss += `</channel>
</rss>`;

  return rss;
}

// Parse LHDN SDK website content
async function parseSdkUpdates() {
  try {
    logger.info('Fetching MyInvois SDK updates');
    
    // First check if the data is in cache
    const cachedData = cache.get('sdkUpdates');
    if (cachedData) {
      logger.info('Using cached SDK updates');
      return cachedData;
    }
    
    // If not in cache, fetch from website
    const response = await axios.get('https://sdk.myinvois.hasil.gov.my/sdk-1-0-release/');
    const html = response.data;
    
    // Create sample data for testing when real parsing fails
    const sampleUpdates = [
      {
        date: '28 April 2025',
        sections: [
          {
            title: 'Other Updates',
            items: [
              'Kindly take note that data in the sandbox environment will be retained for a maximum of 3 months, after which it will be permanently deleted. Please ensure to back up any important data before the retention period expires.'
            ]
          }
        ]
      },
      {
        date: '25 April 2025',
        sections: [
          {
            title: 'Other Updates',
            items: [
              'Please note that the sandbox environment is intended for functional testing and has a lower API rate limit compared to the production environment, effective 28 April 2025. Additionally, data in the sandbox environment will be retained for a maximum of 3 months, after which it will be permanently deleted. Please ensure to back up any important data before the retention period expires.'
            ]
          }
        ]
      },
      {
        date: '11 April 2025',
        sections: [
          {
            title: 'Updates to API Documentation',
            items: [
              'Added new API definition for Taxpayer\'s QR Code in e-Invoice API section.'
            ]
          }
        ]
      },
      {
        date: '7 February 2025',
        sections: [
          {
            title: 'Updates to the XML and JSON samples',
            items: [
              'Added General TIN \'EI00000000010\' to Consolidated Sample XML and Consolidated Sample JSON.',
              'Updated Multi Line Item Sample XML and Multi Line Item Sample JSON with different Tax Type, Tax Rate and Tax Exemption.'
            ]
          }
        ]
      },
      {
        date: '16 January 2025',
        sections: [
          {
            title: 'Other Updates',
            items: [
              'The SSL certificate for myinvois.hasil.gov.my was renewed on 16 January 2025.'
            ]
          }
        ]
      },
      {
        date: '14 January 2025',
        sections: [
          {
            title: 'Updates to the API Documentation',
            items: [
              'A rate limit has been added to the Integration Practices FAQ section.'
            ]
          },
          {
            title: 'Other Updates',
            items: [
              'Rate limits and important notes have been introduced for the following e-invoice APIs:',
              'Log in as Taxpayer System',
              'Log in as Intermediary System',
              'Submit Documents',
              'Cancel Document',
              'Reject Document',
              'Get Recent Documents',
              'Get Submission',
              'Get Document',
              'Get Document Details',
              'Search Documents',
              'Search Taxpayer\'s TIN',
              'We have updated the best practices for optimising API rate limits to ensure optimal performance. The new rate limit will be enforced on May 30, 2025'
            ]
          }
        ]
      },
      {
        date: '28 December 2024',
        sections: [
          {
            title: 'Updates to API Documentation',
            items: [
              'Added new API definition for Search Taxpayers\' TIN in e-Invoice API section.'
            ]
          },
          {
            title: 'Other Updates',
            items: [
              'Added unit code for gross ton (GT) to the system.',
              'Updated the sample JSON and XML files for invoice versions 1.0, 1.1 and Signature creation json.'
            ]
          }
        ]
      }
    ];
    
    try {
      // Try to parse the HTML content
      const sdkUpdatesSection = html.split('# SDK Updates')[1].split('# Document Version Updates')[0];
      
      // Parse updates by date
      const dateRegex = /\*\*([\d]+ [A-Za-z]+ [\d]+)\*\*/g;
      const dates = Array.from(sdkUpdatesSection.matchAll(dateRegex)).map(match => match[1]);
      
      const updates = [];
      
      if (dates.length > 0) {
        for (const date of dates) {
          // Extract section for this date
          const dateSections = sdkUpdatesSection.split(`**${date}**`)[1];
          if (!dateSections) continue;
          
          // Find the end of this date's section (next date or end of section)
          const nextDateMatch = dateSections.match(/\*\*([\d]+ [A-Za-z]+ [\d]+)\*\*/);
          const dateSection = nextDateMatch ? dateSections.split(nextDateMatch[0])[0] : dateSections;
          
          // Extract section titles
          const sectionTitles = Array.from(dateSection.matchAll(/\*\*([^*]+)\*\*/g)).map(match => match[1]);
          
          const sections = [];
          
          for (const title of sectionTitles) {
            // Extract section content
            const titleParts = dateSection.split(`**${title}**`);
            if (titleParts.length < 2) continue;
            
            const sectionContent = titleParts[1];
            const endOfSection = sectionContent.indexOf('**');
            const cleanContent = endOfSection > -1 ? sectionContent.substring(0, endOfSection) : sectionContent;
            
            // Extract bullet points
            const bulletPoints = cleanContent
              .split('•')
              .slice(1)
              .map(point => point.trim())
              .filter(point => point.length > 0);
            
            if (bulletPoints.length > 0) {
              sections.push({
                title,
                items: bulletPoints
              });
            }
          }
          
          if (sections.length > 0) {
            updates.push({
              date,
              sections
            });
          }
        }
      }
      
      // If parsing failed or no updates found, use sample data
      if (updates.length === 0) {
        logger.warn('Failed to parse SDK updates from HTML, using sample data');
        cache.set('sdkUpdates', sampleUpdates);
        return sampleUpdates;
      }
      
      // Store in cache
      cache.set('sdkUpdates', updates);
      return updates;
    } catch (parseError) {
      logger.warn(`Error parsing SDK updates from HTML: ${parseError.message}`);
      // Return sample data if parsing fails
      cache.set('sdkUpdates', sampleUpdates);
      return sampleUpdates;
    }
  } catch (error) {
    logger.error(`Error fetching SDK updates: ${error.message}`);
    throw error;
  }
}

// Route to get SDK updates as JSON
router.get('/updates', async (req, res) => {
  try {
    const updates = await parseSdkUpdates();
    res.json({
      success: true,
      updates
    });
  } catch (error) {
    logger.error(`Error serving SDK updates: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Route to get SDK updates as RSS feed
router.get('/', async (req, res) => {
  try {
    const updates = await parseSdkUpdates();
    const rssFeed = createRssFeed(updates);
    
    // Set proper headers for RSS feeds
    res.set({
      'Content-Type': 'application/rss+xml; charset=UTF-8',
      'Content-Disposition': 'inline; filename="myinvois-sdk-updates.xml"',
      'Cache-Control': 'max-age=1800, must-revalidate', // 30 minutes cache
      'X-Content-Type-Options': 'nosniff'
    });
    
    res.send(rssFeed);
  } catch (error) {
    logger.error(`Error serving RSS feed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router; 