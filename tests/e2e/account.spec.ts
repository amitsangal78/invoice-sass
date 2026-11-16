import { test,expect } from '@playwright/test';
import { mkdir,readdir,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('Owner can sign up, verify email, log out and sign in again',async({page})=>{
  const address=`browser-${Date.now()}@example.test`,password='browser-test-password-2026';
  await page.goto('/');await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
  await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/account-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByLabel('Email address').fill(address);await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Create workspace'}).click();
  await expect(page.getByRole('heading',{name:'Your workspace',exact:true})).toBeVisible();
  await expect(page.getByText('Email verification required',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Request verification code'}).click();
  await expect(page.getByLabel('Email verification code')).toBeVisible();
  let code='';
  await expect.poll(async()=>{
    const directory=resolve('.local/mail');
    for(const name of await readdir(directory).catch(()=>[])){
      const message=JSON.parse(await readFile(resolve(directory,name),'utf8'));
      if(message.to===address){code=message.code;return true;}
    }
    return false;
  },{timeout:15_000}).toBe(true);
  await page.getByLabel('Email verification code').fill(code);await page.getByRole('button',{name:'Verify email',exact:true}).click();
  await expect(page.getByText('Email verified',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign out'}).click();await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
  await page.getByLabel('Email address').fill(address);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in to workspace'}).click();
  await expect(page.getByRole('heading',{name:'Your workspace',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'DRAFT',exact:true})).toBeVisible();
});

test('account screen fits a phone viewport',async({page})=>{
  await page.setViewportSize({width:375,height:812});await page.goto('/');
  await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'.local/screenshots/account-mobile.png',fullPage:true});
});
